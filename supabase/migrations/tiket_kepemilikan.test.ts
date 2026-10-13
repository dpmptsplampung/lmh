// @vitest-environment node
// Kontrak statis migrasi 202610140002_tiket_kepemilikan (tidak mengeksekusi SQL; tidak menyentuh database).
// Sumber: docs/analysis/ANTREAN-ARAH-TULIS.md §5 (Opsi 1, aturan §5.2, tes §5.5) + keputusan CEO 7.1-7.5.
// Rollback: docs/rollback-tiket-kepemilikan-202610140002.sql. Uji perilaku DB: scripts/test-tiket-kepemilikan.mjs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES, MIGRATIONS_DIR, listMigrationFiles, stripSqlComments } from './migration-test-utils';
import { mengandungKontrolTransaksi, mengubahPolicyAtauFungsi } from '../../scripts/lib/sql-txn.mjs';
import { pecahPernyataan } from '../../scripts/lib/migration-markers.mjs';

const BERKAS = '202610140002_tiket_kepemilikan.sql';
const baca = (nama: string) => readFileSync(join(MIGRATIONS_DIR, nama), 'utf8');
const bacaDocs = (...bagian: string[]) => readFileSync(join(MIGRATIONS_DIR, '..', '..', 'docs', ...bagian), 'utf8');
const rapikan = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Definisi lengkap `CREATE [OR REPLACE] FUNCTION public.<nama>(...) ... $$;` dari SQL bebas komentar. */
function ambilFungsi(sql: string, nama: string): string {
  const m = sql.match(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${nama}\\s*\\([\\s\\S]*?\\$\\$;`, 'i'));
  if (!m) throw new Error(`fungsi ${nama} tidak ditemukan`);
  return m[0];
}

/** Pernyataan `REVOKE`/`GRANT` yang menyebut fungsi tertentu. */
function ambilHak(sql: string, kata: 'REVOKE' | 'GRANT', fungsi: string): string {
  const m = sql.match(new RegExp(`${kata}\\s[^;]*public\\.${fungsi}\\s*\\([^;]*;`, 'i'));
  if (!m) throw new Error(`${kata} ${fungsi} tidak ditemukan`);
  return m[0];
}

/** Pernyataan CREATE POLICY <nama> lengkap. */
function ambilPolicy(sql: string, nama: string): string {
  const m = sql.match(new RegExp(`CREATE POLICY ${nama} ON[\\s\\S]*?;`, 'i'));
  if (!m) throw new Error(`policy ${nama} tidak ditemukan`);
  return m[0];
}

const raw = baca(BERKAS);
const sql = stripSqlComments(raw);
const rollbackRaw = bacaDocs('rollback-tiket-kepemilikan-202610140002.sql');
const rollback = stripSqlComments(rollbackRaw);

const mulai = ambilFungsi(sql, 'layanan_mulai');
const selesai = ambilFungsi(sql, 'layanan_selesai');
const finalize = ambilFungsi(sql, 'finalize_pelayanan');
const ambilAlih = ambilFungsi(sql, 'admin_ambil_alih');
const pemilik = ambilFungsi(sql, 'pemilik_tiket');
const penjaga = ambilFungsi(sql, 'guard_visit_transisi_layanan');

const RPC_KLIEN = [
  ['layanan_mulai', 'uuid'],
  ['layanan_selesai', 'uuid, text, jsonb'],
  ['admin_ambil_alih', 'uuid, text'],
] as const;
const SEMUA_FUNGSI = ['layanan_mulai', 'layanan_selesai', 'finalize_pelayanan', 'admin_ambil_alih', 'pemilik_tiket',
  'guard_visit_transisi_layanan'] as const;

// ---------------------------------------------------------------------------------------------------------------
// Simulator predikat trigger penjaga (cermin guard_visit_transisi_layanan)
// ---------------------------------------------------------------------------------------------------------------
interface BarisVisit {
  status: string;
  waktu_mulai_layan: string | null;
  waktu_selesai: string | null;
}
function ditolakPenjaga(lama: BarisVisit, baru: BarisVisit, flagRpc: boolean): boolean {
  if (flagRpc) return false;
  const terlindung = ['dilayani', 'selesai'];
  return (
    (baru.status !== lama.status && (terlindung.includes(baru.status) || terlindung.includes(lama.status)))
    || baru.waktu_mulai_layan !== lama.waktu_mulai_layan
    || baru.waktu_selesai !== lama.waktu_selesai
  );
}
const v = (status: string, mulai: string | null = null, akhir: string | null = null): BarisVisit => ({
  status, waktu_mulai_layan: mulai, waktu_selesai: akhir,
});

describe('Tiket kepemilikan: berkas, urutan, idempoten', () => {
  it('tanpa BEGIN/COMMIT (file maupun rollback) dan terdeteksi pembuat fungsi/policy (wajib --atomic)', () => {
    expect(mengandungKontrolTransaksi(raw)).toBe(false);
    expect(mengandungKontrolTransaksi(rollbackRaw)).toBe(false);
    expect(mengubahPolicyAtauFungsi(raw)).toBe(true);
    expect(raw).toMatch(/apply-migration\.mjs supabase\/migrations\/202610140002_tiket_kepemilikan\.sql --atomic --dry-run/);
  });

  it('terdaftar, nama berpola benar, versi tepat SETELAH 202610140001_sesi_staf dan terbesar', () => {
    expect(FORWARD_MIGRATION_FILES).toContain(BERKAS);
    expect(BERKAS).toMatch(/^\d{12}_[a-z0-9_]+\.sql$/);
    const semua = listMigrationFiles();
    // Migrasi yang lebih baru boleh menyusul (mis. 202610140006); yang dijaga: tepat setelah sesi_staf.
    expect(semua.indexOf(BERKAS)).toBeGreaterThan(-1);
    expect(semua[semua.indexOf(BERKAS) - 1]).toBe('202610140001_sesi_staf.sql');
  });

  it('penjaga prasyarat di awal: sesi_valid(), staf_saya(), boleh_tiket(uuid), kolom dilayani_oleh dan audit_log.nilai_baru', () => {
    const doBlok = sql.match(/DO \$\$[\s\S]*?\$\$;/)![0];
    expect(doBlok).toMatch(/to_regprocedure\('public\.sesi_valid\(\)'\)/);
    expect(doBlok).toMatch(/to_regprocedure\('public\.staf_saya\(\)'\)/);
    expect(doBlok).toMatch(/to_regprocedure\('public\.boleh_tiket\(uuid\)'\)/);
    expect(doBlok).toMatch(/attname = 'dilayani_oleh'/);
    expect(doBlok).toMatch(/attname = 'nilai_baru'/);
    expect(sql.search(/DO \$\$/)).toBeLessThan(sql.search(/CREATE OR REPLACE FUNCTION/));
  });

  it('idempoten: hanya CREATE OR REPLACE FUNCTION, DROP ... IF EXISTS, policy DROP IF EXISTS + CREATE', () => {
    expect(sql).not.toMatch(/CREATE\s+FUNCTION/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b|\bDELETE\s+FROM\b|ALTER\s+TABLE|CREATE\s+TABLE|CASCADE/i);
    for (const m of sql.matchAll(/\bDROP\s+(\w+)\s+(?!IF\s+EXISTS)/gi)) throw new Error(`DROP tanpa IF EXISTS: ${m[0]}`);
    const policyDibuat = [...sql.matchAll(/CREATE POLICY (\w+) ON/g)].map((m) => m[1]);
    for (const p of policyDibuat) expect(sql).toMatch(new RegExp(`DROP POLICY IF EXISTS ${p} ON`));
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS trg_guard_visit_transisi_layanan ON public\.visit;/);
  });

  it('daftar pernyataan: hanya objek milik A3 (tanpa sync_visit_dual_write, panggil_tiket, visit/kunjungan policy)', () => {
    const label = pecahPernyataan(sql).map(
      (p: string) =>
        rapikan(p).match(
          /^(DO|CREATE OR REPLACE FUNCTION [\w.]+|REVOKE ALL ON FUNCTION [\w.]+|GRANT EXECUTE ON FUNCTION [\w.]+|DROP TRIGGER IF EXISTS \w+ ON [\w.]+|CREATE TRIGGER \w+|DROP POLICY IF EXISTS \w+ ON [\w.]+|CREATE POLICY \w+ ON [\w.]+|UPDATE [\w.]+)/,
        )?.[1] ?? `TAK DIKENAL: ${rapikan(p).slice(0, 80)}`,
    );
    expect(label.filter((l: string) => l.startsWith('TAK DIKENAL'))).toEqual([]);
    const fungsi = new Set(label.filter((l: string) => l.startsWith('CREATE OR REPLACE FUNCTION')).map((l: string) => l.split(' ').at(-1)));
    expect([...fungsi].sort()).toEqual(SEMUA_FUNGSI.map((f) => `public.${f}`).sort());
    expect(label.filter((l: string) => l.startsWith('UPDATE'))).toEqual(['UPDATE public.tiket_antrean']);
    expect(sql).not.toMatch(/sync_visit_dual_write|panggil_tiket|antrean_broadcast/);
    expect(sql).not.toMatch(/POLICY\s+(?:IF\s+EXISTS\s+)?\w+\s+ON\s+public\.(?:visit|kunjungan)\b/i);
  });
});

describe('Tiket kepemilikan: SECURITY DEFINER dan hak eksekusi', () => {
  it.each([...SEMUA_FUNGSI])('%s: SECURITY DEFINER dan search_path terkunci', (nama) => {
    const f = ambilFungsi(sql, nama);
    expect(f).toMatch(/^CREATE OR REPLACE FUNCTION/);
    expect(f).toMatch(/SECURITY DEFINER/);
    expect(f).toMatch(/SET search_path = pg_catalog, public\s/);
  });

  it.each(RPC_KLIEN)('%s(%s): REVOKE dari PUBLIC, anon, authenticated lalu GRANT hanya ke authenticated', (nama, arg) => {
    const revoke = ambilHak(sql, 'REVOKE', nama);
    const grant = ambilHak(sql, 'GRANT', nama);
    expect(rapikan(revoke)).toBe(`REVOKE ALL ON FUNCTION public.${nama}(${arg}) FROM PUBLIC, anon, authenticated;`);
    expect(rapikan(grant)).toBe(`GRANT EXECUTE ON FUNCTION public.${nama}(${arg}) TO authenticated;`);
    expect(sql.indexOf(revoke)).toBeLessThan(sql.indexOf(grant));
  });

  it('finalize_pelayanan: signature dan grant SAMA dengan 202610010001', () => {
    expect(rapikan(finalize)).toMatch(/^CREATE OR REPLACE FUNCTION public\.finalize_pelayanan\( p_tiket_id uuid, p_form_type text, p_payload jsonb \) RETURNS jsonb/);
    const lama = stripSqlComments(baca('202610010001_non_oss_rename.sql'));
    for (const kata of ['REVOKE', 'GRANT'] as const) {
      expect(rapikan(ambilHak(sql, kata, 'finalize_pelayanan'))).toBe(rapikan(ambilHak(lama, kata, 'finalize_pelayanan')));
    }
  });

  it('pemilik_tiket (helper RLS): GRANT ke authenticated (dipakai policy) dan service_role; anon tidak', () => {
    expect(rapikan(ambilHak(sql, 'REVOKE', 'pemilik_tiket'))).toBe('REVOKE ALL ON FUNCTION public.pemilik_tiket(uuid) FROM PUBLIC, anon, authenticated;');
    expect(rapikan(ambilHak(sql, 'GRANT', 'pemilik_tiket'))).toBe('GRANT EXECUTE ON FUNCTION public.pemilik_tiket(uuid) TO authenticated, service_role;');
  });

  it('fungsi trigger penjaga tidak dapat dipanggil klien (REVOKE tanpa GRANT)', () => {
    expect(rapikan(ambilHak(sql, 'REVOKE', 'guard_visit_transisi_layanan'))).toBe(
      'REVOKE ALL ON FUNCTION public.guard_visit_transisi_layanan() FROM PUBLIC, anon, authenticated;',
    );
    expect(sql).not.toMatch(/GRANT[^;]*guard_visit_transisi_layanan/);
  });

  it('tidak ada fungsi publik yang menerima teks lalu meneruskannya ke set_config (flag tak bisa diset klien)', () => {
    for (const nama of SEMUA_FUNGSI) {
      const f = ambilFungsi(sql, nama);
      for (const m of f.matchAll(/set_config\(([^)]*)\)/g)) {
        expect(m[1]).toMatch(/^'lmh\.antrean_rpc', '(on|off)', true$/);
      }
    }
  });
});

describe('Tiket kepemilikan: layanan_mulai', () => {
  it('identitas dari staf_saya(); FORBIDDEN (42501) bila bukan staf aktif; sesi_valid() dipanggil -> SESI_TIDAK_SAH 42501', () => {
    expect(mulai).toMatch(/FROM public\.staf_saya\(\) AS me/);
    expect(mulai).toMatch(/IF v_me_id IS NULL THEN\s+RAISE EXCEPTION 'FORBIDDEN:[^']*' USING ERRCODE = '42501';/);
    expect(mulai).toMatch(/IF NOT public\.sesi_valid\(\) THEN\s+RAISE EXCEPTION 'SESI_TIDAK_SAH:[^']*' USING ERRCODE = '42501';/);
    expect(mulai).not.toMatch(/p_staf|p_petugas|p_user/);
  });

  it('peran (CEO 7.1): admin semua layanan, petugas hanya layanannya, front_office TIDAK disebut (ditolak)', () => {
    expect(rapikan(mulai)).toContain(
      "IF NOT ( v_me_role = 'admin' OR (v_me_role = 'petugas' AND v_me_layanan IS NOT NULL AND v_me_layanan = v_t.layanan_id) ) THEN",
    );
    expect(mulai).not.toMatch(/front_office/);
  });

  it('NOT_FOUND (P0002) untuk tiket tak ada', () => {
    expect(mulai).toMatch(/IF NOT FOUND THEN\s+RAISE EXCEPTION 'NOT_FOUND:[^']*' USING ERRCODE = 'P0002';/);
  });

  it('urutan kunci visit -> kunjungan -> tiket: FOR UPDATE visit dan kunjungan SEBELUM UPDATE tiket', () => {
    const iVisit = mulai.search(/FROM public\.visit AS v WHERE v\.id = v_t\.legacy_visit_id FOR UPDATE/);
    const iKunj = mulai.search(/FROM public\.kunjungan AS k WHERE k\.id = v_t\.kunjungan_id FOR UPDATE/);
    const iTiket = mulai.search(/UPDATE public\.tiket_antrean/);
    expect(iVisit).toBeGreaterThan(0);
    expect(iKunj).toBeGreaterThan(iVisit);
    expect(iTiket).toBeGreaterThan(iKunj);
  });

  it("guard atomik: WHERE status IN ('menunggu','dipanggil') AND dilayani_oleh IS NULL, mengisi dilayani_oleh = pemanggil", () => {
    const upd = rapikan(mulai.match(/UPDATE public\.tiket_antrean AS t[\s\S]*?;/)![0]);
    expect(upd).toContain("SET status = 'dilayani', dilayani_oleh = v_me_id, waktu_mulai_layan = v_now, updated_at = v_now");
    expect(upd).toContain("WHERE t.id = p_tiket_id AND t.status IN ('menunggu', 'dipanggil') AND t.dilayani_oleh IS NULL;");
    expect(mulai).toMatch(/GET DIAGNOSTICS v_n = ROW_COUNT;\s+IF v_n = 0 THEN/);
  });

  it('0 baris: milik sendiri -> ok sudah_milik_anda (idempoten); dilayani/selesai -> SUDAH_DIAMBIL; selain itu INVALID_STATUS', () => {
    const blok = rapikan(mulai.match(/IF v_n = 0 THEN[\s\S]*?\n  END IF;/)![0]);
    expect(blok).toMatch(/IF v_cek\.status = 'dilayani' AND v_cek\.dilayani_oleh = v_me_id THEN RETURN pg_catalog\.jsonb_build_object\( 'ok', true, 'sudah_milik_anda', true/);
    expect(blok).toMatch(/IF v_cek\.status IN \('dilayani', 'selesai'\) THEN RAISE EXCEPTION 'SUDAH_DIAMBIL:/);
    expect(blok).toMatch(/RAISE EXCEPTION 'INVALID_STATUS:/);
    expect(blok.indexOf('sudah_milik_anda')).toBeLessThan(blok.indexOf('SUDAH_DIAMBIL'));
  });

  it("sinkron visit: flag lokal on -> UPDATE visit WHERE status = 'menunggu' dengan v_now yang sama -> flag off; selain 1 baris = DIVERGENSI", () => {
    const blok = rapikan(mulai.match(/PERFORM pg_catalog\.set_config\('lmh\.antrean_rpc', 'on', true\);[\s\S]*?DIVERGENSI[^;]*;/)![0]);
    expect(blok).toMatch(/^PERFORM pg_catalog\.set_config\('lmh\.antrean_rpc', 'on', true\); UPDATE public\.visit AS v SET status = 'dilayani', waktu_mulai_layan = v_now WHERE v\.id = v_t\.legacy_visit_id AND v\.status = 'menunggu'; GET DIAGNOSTICS v_n = ROW_COUNT; PERFORM pg_catalog\.set_config\('lmh\.antrean_rpc', 'off', true\); IF v_n <> 1 THEN RAISE EXCEPTION 'DIVERGENSI:/);
    expect(mulai.search(/UPDATE public\.visit/)).toBeGreaterThan(mulai.search(/UPDATE public\.tiket_antrean/));
    expect(mulai).toMatch(/v_now\s+timestamptz := pg_catalog\.now\(\);/);
  });
});

describe('Tiket kepemilikan: layanan_selesai', () => {
  it('signature (uuid, text DEFAULT NULL, jsonb DEFAULT NULL)', () => {
    expect(rapikan(selesai)).toMatch(/^CREATE OR REPLACE FUNCTION public\.layanan_selesai\( p_tiket_id uuid, p_form_type text DEFAULT NULL, p_payload jsonb DEFAULT NULL \) RETURNS jsonb/);
  });

  it('staf_saya + sesi_valid (SESI_TIDAK_SAH 42501); Front Office ditolak (hanya admin/petugas)', () => {
    expect(selesai).toMatch(/FROM public\.staf_saya\(\) AS me/);
    expect(selesai).toMatch(/IF NOT public\.sesi_valid\(\) THEN\s+RAISE EXCEPTION 'SESI_TIDAK_SAH:[^']*' USING ERRCODE = '42501';/);
    expect(selesai).toMatch(/IF v_me_role NOT IN \('admin', 'petugas'\) THEN\s+RAISE EXCEPTION 'FORBIDDEN:[^']*' USING ERRCODE = '42501';/);
  });

  it('urutan kunci visit -> kunjungan -> tiket (FOR UPDATE) sebelum pemeriksaan status/pemilik dan sebelum tulis apa pun', () => {
    const iVisit = selesai.search(/FROM public\.visit AS v WHERE v\.id = v_legacy FOR UPDATE/);
    const iKunj = selesai.search(/FROM public\.kunjungan AS k WHERE k\.id = v_kunj FOR UPDATE/);
    const iTiket = selesai.search(/FROM public\.tiket_antrean AS t WHERE t\.id = p_tiket_id FOR UPDATE/);
    const iStatus = selesai.search(/IF v_t\.status <> 'dilayani'/);
    const iTulis = selesai.search(/INSERT INTO|UPDATE public\./);
    expect(iVisit).toBeGreaterThan(0);
    expect(iKunj).toBeGreaterThan(iVisit);
    expect(iTiket).toBeGreaterThan(iKunj);
    expect(iStatus).toBeGreaterThan(iTiket);
    expect(iTulis).toBeGreaterThan(iStatus);
  });

  it('INVALID_STATUS bila bukan dilayani, lalu BUKAN_PEMILIK (42501) bila dilayani_oleh bukan pemanggil (admin pun)', () => {
    expect(selesai).toMatch(/IF v_t\.status <> 'dilayani' THEN\s+RAISE EXCEPTION 'INVALID_STATUS:/);
    expect(selesai).toMatch(/IF v_t\.dilayani_oleh IS DISTINCT FROM v_me_id THEN\s+RAISE EXCEPTION 'BUKAN_PEMILIK:[^']*' USING ERRCODE = '42501';/);
    expect(selesai.search(/INVALID_STATUS/)).toBeLessThan(selesai.search(/BUKAN_PEMILIK/));
    // Tidak ada pengecualian admin untuk aturan pemilik.
    const cekPemilik = selesai.slice(selesai.search(/IF v_t\.dilayani_oleh IS DISTINCT FROM/), selesai.search(/BUKAN_PEMILIK/));
    expect(cekPemilik).not.toMatch(/admin/);
  });

  it('UPDATE tiket: WHERE status dilayani AND dilayani_oleh = v_me_id; lalu visit dengan flag dan v_now yang sama; DIVERGENSI', () => {
    const upd = rapikan(selesai.match(/UPDATE public\.tiket_antrean AS t[\s\S]*?;/)![0]);
    expect(upd).toBe(
      "UPDATE public.tiket_antrean AS t SET status = 'selesai', waktu_selesai = v_now, updated_at = v_now WHERE t.id = p_tiket_id AND t.status = 'dilayani' AND t.dilayani_oleh = v_me_id;",
    );
    const blok = rapikan(selesai.match(/PERFORM pg_catalog\.set_config\('lmh\.antrean_rpc', 'on', true\);[\s\S]*?DIVERGENSI[^;]*;/)![0]);
    expect(blok).toMatch(/UPDATE public\.visit AS v SET status = 'selesai', waktu_selesai = v_now WHERE v\.id = v_t\.legacy_visit_id AND v\.status = 'dilayani'; GET DIAGNOSTICS v_n = ROW_COUNT; PERFORM pg_catalog\.set_config\('lmh\.antrean_rpc', 'off', true\); IF v_n <> 1 THEN RAISE EXCEPTION 'DIVERGENSI:/);
    expect([...selesai.matchAll(/DIVERGENSI/g)]).toHaveLength(2);
  });

  it('pendataan (CEO 7.4): logika upsert finalize_pelayanan 202610010001 apa adanya, petugas_id = pemilik (v_me_id)', () => {
    const lama = ambilFungsi(stripSqlComments(baca('202610010001_non_oss_rename.sql')), 'finalize_pelayanan');
    // Dari cabang 'oss' sampai UPDATE pelayanan_perizinan terakhir (WHERE tiket_id = p_tiket_id;).
    const ambilUpsert = (f: string) => {
      const akhir = 'WHERE tiket_id = p_tiket_id;';
      return rapikan(f.slice(f.search(/IF p_form_type = 'oss' THEN/), f.lastIndexOf(akhir) + akhir.length));
    };
    const normal = (s: string) =>
      s.replace(/v_tiket\.kunjungan_id/g, 'v_t.kunjungan_id')
        .replace(/v_staff\.id/g, 'v_me_id')
        .replace(/v_role/g, 'v_me_role')
        .replace(/petugas_id = v_me_id, /g, '');
    expect(ambilUpsert(selesai).length).toBeGreaterThan(1000);
    expect(normal(ambilUpsert(selesai))).toBe(normal(ambilUpsert(lama)));
    // Baris baru dan baris draf eksisting sama-sama menjadi milik pemilik.
    expect([...selesai.matchAll(/p_tiket_id, v_t\.kunjungan_id, v_me_id,/g)]).toHaveLength(2);
    expect([...selesai.matchAll(/petugas_id\s+= v_me_id,/g)]).toHaveLength(2);
  });

  it('form NULL = layanan tanpa pendataan (tanpa upsert); form tak dikenal = INVALID_FORM; is_locked = form diisi', () => {
    expect(selesai).toMatch(/IF p_form_type IS NOT NULL AND p_form_type NOT IN \('oss', 'perizinan'\) THEN\s+RAISE EXCEPTION 'INVALID_FORM:/);
    expect(rapikan(selesai)).toContain("'ok', true, 'is_locked', p_form_type IS NOT NULL, 'waktu_selesai', v_now");
  });
});

describe('Tiket kepemilikan: finalize_pelayanan pembungkus', () => {
  it('tidak lagi memuat front_office, hanya mendelegasikan ke layanan_selesai (form wajib dipertahankan)', () => {
    expect(finalize).not.toMatch(/front_office|UPDATE|INSERT|get_my_role/);
    expect(finalize).toMatch(/RETURN public\.layanan_selesai\(p_tiket_id, p_form_type, p_payload\);/);
    expect(finalize).toMatch(/IF p_form_type IS NULL OR p_form_type NOT IN \('oss', 'perizinan'\) THEN\s+RAISE EXCEPTION 'INVALID_FORM:/);
  });
});

describe('Tiket kepemilikan: admin_ambil_alih (CEO 7.2)', () => {
  it('hanya Admin aktif; sesi_valid; alasan >= 5 karakter (ALASAN_WAJIB 22023)', () => {
    expect(ambilAlih).toMatch(/IF v_me_id IS NULL OR v_me_role IS DISTINCT FROM 'admin' THEN\s+RAISE EXCEPTION 'FORBIDDEN:[^']*' USING ERRCODE = '42501';/);
    expect(ambilAlih).toMatch(/IF NOT public\.sesi_valid\(\) THEN\s+RAISE EXCEPTION 'SESI_TIDAK_SAH:/);
    expect(ambilAlih).toMatch(/char_length\(pg_catalog\.btrim\(p_alasan\)\) < 5 THEN\s+RAISE EXCEPTION 'ALASAN_WAJIB:[^']*' USING ERRCODE = '22023';/);
  });

  it("tiket dikunci FOR UPDATE; harus 'dilayani'; tidak mengubah status/waktu (SET hanya dilayani_oleh)", () => {
    expect(ambilAlih).toMatch(/FROM public\.tiket_antrean AS t WHERE t\.id = p_tiket_id FOR UPDATE;/);
    expect(ambilAlih).toMatch(/IF v_t\.status <> 'dilayani' THEN\s+RAISE EXCEPTION 'INVALID_STATUS:/);
    const upd = rapikan(ambilAlih.match(/UPDATE public\.tiket_antrean[\s\S]*?;/)![0]);
    expect(upd).toBe("UPDATE public.tiket_antrean AS t SET dilayani_oleh = v_me_id WHERE t.id = p_tiket_id AND t.status = 'dilayani';");
    expect([...ambilAlih.matchAll(/\bUPDATE public\./g)]).toHaveLength(1);
    expect(ambilAlih).not.toMatch(/public\.visit/);
  });

  it('audit_log: pemilik lama, pemilik baru, alasan (pola koreksi_pelayanan + nilai_lama/nilai_baru)', () => {
    const ins = rapikan(ambilAlih.match(/INSERT INTO public\.audit_log[\s\S]*?\);\s/)![0]);
    expect(ins).toContain('(actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru)');
    expect(ins).toContain("auth.uid(), v_me_role, 'admin_ambil_alih', 'tiket_antrean', p_tiket_id::text");
    expect(ins).toContain("'pemilik_lama', v_t.dilayani_oleh");
    expect(ins).toContain("'pemilik_baru', v_me_id");
    expect(ins).toContain("'alasan', pg_catalog.btrim(p_alasan)");
    expect(ins).toContain("pg_catalog.jsonb_build_object('dilayani_oleh', v_t.dilayani_oleh), pg_catalog.jsonb_build_object('dilayani_oleh', v_me_id)");
  });

  it('kolom audit_log yang dipakai memang ada (baseline + 202610090004)', () => {
    const awal = stripSqlComments(baca('202607140003_feature_schema.sql'));
    const tabel = awal.match(/CREATE TABLE public\.audit_log \([\s\S]*?\);/)![0];
    for (const k of ['actor_id', 'actor_role', 'aksi', 'entitas', 'entitas_id', 'detail']) expect(tabel).toContain(k);
    const ubah = stripSqlComments(baca('202610090004_kelola_layanan_audit.sql'));
    expect(ubah).toMatch(/ADD COLUMN IF NOT EXISTS nilai_lama jsonb,\s+ADD COLUMN IF NOT EXISTS nilai_baru jsonb/);
  });
});

describe('Tiket kepemilikan: trigger penjaga visit', () => {
  it('BEFORE UPDATE ON public.visit FOR EACH ROW; nama terurut sebelum trg_visit_qr_hangus / trg_visit_updated', () => {
    expect(rapikan(sql)).toContain(
      'CREATE TRIGGER trg_guard_visit_transisi_layanan BEFORE UPDATE ON public.visit FOR EACH ROW EXECUTE FUNCTION public.guard_visit_transisi_layanan();',
    );
    expect('trg_guard_visit_transisi_layanan' < 'trg_visit_qr_hangus').toBe(true);
    expect('trg_guard_visit_transisi_layanan' < 'trg_visit_updated').toBe(true);
  });

  it('flag yang dibaca penjaga SAMA dengan yang dinyalakan RPC (lokal transaksi), galat TRANSISI_LEWAT_RPC 42501', () => {
    expect(penjaga).toMatch(/COALESCE\(pg_catalog\.current_setting\('lmh\.antrean_rpc', true\), ''\) = 'on'/);
    expect(penjaga).toMatch(/RAISE EXCEPTION 'TRANSISI_LEWAT_RPC:[^']*'\s+USING ERRCODE = '42501';/);
    for (const f of [mulai, selesai]) {
      expect([...f.matchAll(/set_config\('lmh\.antrean_rpc', 'on', true\)/g)]).toHaveLength(1);
      expect([...f.matchAll(/set_config\('lmh\.antrean_rpc', 'off', true\)/g)]).toHaveLength(1);
    }
    expect(ambilAlih).not.toMatch(/set_config/);
  });

  it('predikat SQL = simulator', () => {
    expect(rapikan(penjaga)).toContain(
      "IF (NEW.status IS DISTINCT FROM OLD.status AND (NEW.status IN ('dilayani', 'selesai') OR OLD.status IN ('dilayani', 'selesai'))) OR NEW.waktu_mulai_layan IS DISTINCT FROM OLD.waktu_mulai_layan OR NEW.waktu_selesai IS DISTINCT FROM OLD.waktu_selesai THEN",
    );
  });

  describe('simulator: jalur lain tetap lolos, transisi layanan langsung ditolak', () => {
    const T = '2026-10-14T03:00:00Z';
    it.each([
      ['scan check-in terjadwal -> menunggu', v('terjadwal'), v('menunggu'), false, false],
      ['tolak reservasi terjadwal -> batal', v('terjadwal'), v('batal'), false, false],
      ['cron akhir hari menunggu -> tidak_terlayani', v('menunggu'), v('tidak_terlayani'), false, false],
      ['cron no-show terjadwal -> no_show', v('terjadwal'), v('no_show'), false, false],
      ['ubah kolom lain (catatan) pada tiket dilayani', v('dilayani', T), v('dilayani', T), false, false],
      ['klien lama: menunggu -> dilayani', v('menunggu'), v('dilayani', T), false, true],
      ['klien lama: dilayani -> selesai', v('dilayani', T), v('selesai', T, T), false, true],
      ['mundur: selesai -> menunggu', v('selesai', T, T), v('menunggu', T, T), false, true],
      ['ubah waktu_mulai_layan saja', v('dilayani', T), v('dilayani', '2026-10-14T04:00:00Z'), false, true],
      ['RPC (flag on): menunggu -> dilayani', v('menunggu'), v('dilayani', T), true, false],
      ['RPC (flag on): dilayani -> selesai', v('dilayani', T), v('selesai', T, T), true, false],
    ])('%s', (_n, lama, baru, flag, tolak) => {
      expect(ditolakPenjaga(lama, baru, flag)).toBe(tolak);
    });
  });

  it('job cron yang menulis visit hanya menyentuh menunggu/terjadwal (tidak terhalang penjaga)', () => {
    const akhir = stripSqlComments(baca('202607300017_wp23_akhir_hari_panggil.sql'));
    expect(rapikan(akhir)).toContain("SET status = 'tidak_terlayani', updated_at = now()");
    expect(rapikan(akhir)).toContain("AND v.status = 'menunggu'");
    const noShow = rapikan(stripSqlComments(baca('202608310002_reservasi_no_show.sql')));
    expect(noShow).toMatch(/UPDATE public\.visit[\s\S]*?status = 'no_show'/);
    expect(noShow).not.toMatch(/waktu_mulai_layan|waktu_selesai/);
  });
});

describe('Tiket kepemilikan: policy', () => {
  it('DROP POLICY tiket_staff_update tanpa policy UPDATE pengganti pada tiket_antrean', () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS tiket_staff_update ON public\.tiket_antrean;/);
    expect(sql).not.toMatch(/CREATE POLICY[^;]*ON public\.tiket_antrean/i);
  });

  it('pemilik_tiket(): tiket dilayani DAN dilayani_oleh = staf aktif pemanggil', () => {
    expect(rapikan(pemilik)).toContain(
      "FROM public.tiket_antrean AS t JOIN public.staf_saya() AS me ON me.id = t.dilayani_oleh WHERE t.id = p_tiket AND t.status = 'dilayani'",
    );
    expect(pemilik).toMatch(/STABLE/);
  });

  it.each([
    ['oss_insert_staff', 'pelayanan_oss'],
    ['oss_update_staff', 'pelayanan_oss'],
    ['perizinan_insert_staff', 'pelayanan_perizinan'],
    ['perizinan_update_staff', 'pelayanan_perizinan'],
  ])('%s: syarat lama 202610090001 dipertahankan + pemilik_tiket(tiket_id) (CEO 7.5)', (nama, tabel) => {
    const lama = rapikan(ambilPolicy(stripSqlComments(baca('202610090001_rbac_tahap1.sql')), nama));
    const baru = rapikan(ambilPolicy(sql, nama));
    expect(baru).toContain(`ON public.${tabel} FOR`);
    expect(baru.replace(/ AND public\.pemilik_tiket\(tiket_id\)/g, '').replace(/\( /g, '(').replace(/ \)/g, ')'))
      .toBe(lama.replace(/\( /g, '(').replace(/ \)/g, ')'));
    const n = [...baru.matchAll(/public\.pemilik_tiket\(tiket_id\)/g)].length;
    expect(n).toBe(nama.includes('update') ? 2 : 1);
  });
});

describe('Tiket kepemilikan: backfill dilayani_oleh (CEO 7.3)', () => {
  const upd = rapikan(sql.slice(sql.search(/UPDATE public\.tiket_antrean AS t\s+SET dilayani_oleh = b\.petugas_id/)));

  it("hanya tiket 'dilayani' dengan dilayani_oleh NULL (tidak menyentuh selesai/histori)", () => {
    expect(upd).toContain("WHERE t2.status = 'dilayani' AND t2.dilayani_oleh IS NULL AND t2.legacy_visit_id IS NOT NULL");
    expect(upd).toContain("AND t.status = 'dilayani' AND t.dilayani_oleh IS NULL;");
    expect(upd).toContain('AND b.petugas_id IS NOT NULL');
  });

  it('entri audit TERAKHIR dulu (LIMIT 1), BARU dipetakan ke petugas: aktor tak terpetakan -> NULL, tidak menebak', () => {
    expect(upd).toContain(
      "FROM (SELECT a.actor_id FROM public.audit_log AS a WHERE a.entitas = 'visit' AND a.aksi = 'update_status' AND a.entitas_id = t2.legacy_visit_id::text AND a.detail ->> 'status' = 'dilayani' ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS terakhir JOIN public.petugas AS p ON p.auth_user_id = terakhir.actor_id",
    );
  });

  it('cocok dengan bentuk audit trigger visit (aksi update_status, entitas = nama tabel, detail.status = NEW.status)', () => {
    const base = stripSqlComments(baca('202607140004_security_and_automation.sql'));
    expect(base).toMatch(/CREATE TRIGGER trg_audit_visit_status AFTER UPDATE OF status ON public\.visit\s+FOR EACH ROW EXECUTE FUNCTION public\.audit_change\('update_status'\);/);
    expect(base).toMatch(/'status', status_val/);
    expect(base).toMatch(/TG_TABLE_NAME,\s+entity_id/);
    const petugas = stripSqlComments(baca('202607140002_core_schema.sql'));
    expect(petugas).toMatch(/auth_user_id uuid NOT NULL UNIQUE REFERENCES auth\.users\(id\)/);
  });
});

describe('Tiket kepemilikan: rollback', () => {
  it('penjaga di awal menolak bila fungsi/policy lain masih memakai fungsi A3, SEBELUM DROP/CREATE apa pun', () => {
    const doBlok = rollback.match(/DO \$\$[\s\S]*?\$\$;/)![0];
    expect(doBlok).toMatch(/layanan_mulai\|layanan_selesai\|admin_ambil_alih\|pemilik_tiket/);
    expect(doBlok).toMatch(/pg_policies/);
    expect([...doBlok.matchAll(/RAISE EXCEPTION/g)]).toHaveLength(2);
    expect(rollback.search(/\bDROP\b/)).toBeGreaterThan(rollback.search(/DO \$\$/));
  });

  it('finalize_pelayanan dipulihkan PERSIS dari 202610010001 (beserta REVOKE/GRANT)', () => {
    const lama = stripSqlComments(baca('202610010001_non_oss_rename.sql'));
    expect(rapikan(ambilFungsi(rollback, 'finalize_pelayanan'))).toBe(rapikan(ambilFungsi(lama, 'finalize_pelayanan')));
    for (const kata of ['REVOKE', 'GRANT'] as const) {
      expect(rapikan(ambilHak(rollback, kata, 'finalize_pelayanan'))).toBe(rapikan(ambilHak(lama, kata, 'finalize_pelayanan')));
    }
  });

  it('tiket_staff_update dibuat ulang PERSIS dari 202607290013', () => {
    const lama = stripSqlComments(baca('202607290013_kunjungan_tiket.sql'));
    expect(rapikan(ambilPolicy(rollback, 'tiket_staff_update'))).toBe(rapikan(ambilPolicy(lama, 'tiket_staff_update')));
  });

  it.each(['oss_insert_staff', 'oss_update_staff', 'perizinan_insert_staff', 'perizinan_update_staff'])(
    '%s dipulihkan PERSIS dari 202610090001',
    (nama) => {
      const lama = stripSqlComments(baca('202610090001_rbac_tahap1.sql'));
      expect(rapikan(ambilPolicy(rollback, nama))).toBe(rapikan(ambilPolicy(lama, nama)));
    },
  );

  it('menghapus trigger + 5 fungsi milik A3 (IF EXISTS), tanpa CASCADE, tanpa mengubah data', () => {
    expect(rollback).toMatch(/DROP TRIGGER IF EXISTS trg_guard_visit_transisi_layanan ON public\.visit;/);
    for (const f of ['guard_visit_transisi_layanan()', 'admin_ambil_alih(uuid, text)', 'layanan_selesai(uuid, text, jsonb)',
      'layanan_mulai(uuid)', 'pemilik_tiket(uuid)']) {
      expect(rollback).toContain(`DROP FUNCTION IF EXISTS public.${f};`);
    }
    expect([...rollback.matchAll(/DROP FUNCTION IF EXISTS/g)]).toHaveLength(5);
    // Tulis data hanya di dalam badan finalize_pelayanan yang dipulihkan (dan blok DO penjaga hanya membaca).
    const diluarFungsi = rollback.replace(/CREATE OR REPLACE FUNCTION[\s\S]*?\$\$;/g, '');
    expect(diluarFungsi).not.toMatch(/CASCADE|\bTRUNCATE\b|\bDELETE\b|\bINSERT INTO\b|\bUPDATE\s+public\./i);
    expect(rollback.match(/DO \$\$[\s\S]*?\$\$;/)![0]).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/);
  });

  it('pemilik_tiket di-DROP SETELAH policy yang memakainya dipulihkan', () => {
    expect(rollback.indexOf('DROP FUNCTION IF EXISTS public.pemilik_tiket')).toBeGreaterThan(
      rollback.lastIndexOf('CREATE POLICY perizinan_update_staff'),
    );
  });
});

describe('Tiket kepemilikan: pencatatan (docs/ATURAN_MIGRASI.md #4)', () => {
  it('tercatat di docs/MIGRATIONS.md dan docs/analysis/DB-CHANGES.md: BELUM DITERAPKAN, urutan, jam penerapan, TRANSISI_LEWAT_RPC, skrip lama', () => {
    const migrations = bacaDocs('MIGRATIONS.md');
    expect(migrations).toContain('202610140002_tiket_kepemilikan');
    const dbChanges = bacaDocs('analysis', 'DB-CHANGES.md');
    const entri = dbChanges.slice(dbChanges.indexOf('202610140002_tiket_kepemilikan'));
    expect(entri).toMatch(/^[\s\S]{0,6000}BELUM DITERAPKAN/);
    expect(entri).toMatch(/^[\s\S]{0,6000}202610140001/);
    expect(entri).toMatch(/^[\s\S]{0,6000}TRANSISI_LEWAT_RPC/);
    expect(entri).toMatch(/^[\s\S]{0,6000}selftest-wp21/);
  });
});
