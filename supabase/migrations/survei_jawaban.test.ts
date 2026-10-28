// @vitest-environment node
// Kontrak statis migrasi 202611020002_survei_jawaban (survei terpadu Fase A, Task 3): skm_respons diperluas (11 unsur,
// versi/sumber/unit), tabel spak_respons, hitung_ikm 9/10/11 unsur, ringkasan_ikm/ringkasan_spak/ringkasan_response_rate,
// dan v_skm_petugas dengan u10/u11. Tidak mengeksekusi SQL dan tidak menyentuh database. Uji PERILAKU:
// scripts/lokal/skenario-survei-jawaban.mjs (PGlite lokal). Rollback: docs/rollback-survei-jawaban-202611020002.sql.
// Kecocokan rentang CHECK dan kunci dengan src/lib/survei/pertanyaan.ts diperiksa di blok "kecocokan" di bawah (Task 6).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERTANYAAN_SPAK, RENTANG, UNSUR_SKM } from '../../src/lib/survei/pertanyaan';
import { FORWARD_MIGRATION_FILES, MIGRATIONS_DIR, listMigrationFiles, stripSqlComments } from './migration-test-utils';
import { mengandungKontrolTransaksi, mengubahPolicyAtauFungsi } from '../../scripts/lib/sql-txn.mjs';
import { pecahPernyataan } from '../../scripts/lib/migration-markers.mjs';

const BERKAS = '202611020002_survei_jawaban.sql';
const BERKAS_UNDANGAN = '202611020001_survei_undangan.sql';
const BERKAS_ROLLBACK = 'rollback-survei-jawaban-202611020002.sql';

const baca = (nama: string) => readFileSync(join(MIGRATIONS_DIR, nama), 'utf8').replace(/\r\n/g, '\n');
const bacaDocs = (...bagian: string[]) => readFileSync(join(MIGRATIONS_DIR, '..', '..', 'docs', ...bagian), 'utf8').replace(/\r\n/g, '\n');
const rapikan = (s: string) => s.replace(/\s+/g, ' ').trim();
const tanpaTitikKoma = (s: string) => rapikan(s).replace(/;$/, '');

const raw = baca(BERKAS);
const sql = stripSqlComments(raw);
const pernyataan = pecahPernyataan(sql).map(rapikan);
const rollbackRaw = bacaDocs(BERKAS_ROLLBACK);
const rollback = stripSqlComments(rollbackRaw);
const pernyataanRollback = pecahPernyataan(rollback).map(rapikan);

/** Definisi lengkap `CREATE [OR REPLACE] FUNCTION public.<nama>(...) ... $$;` dari SQL bebas komentar. */
function ambilFungsi(teks: string, nama: string): string {
  const hasil = [...teks.matchAll(new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.${nama}\s*\([\s\S]*?\$\$;`, 'gi'))].map((m) => m[0]);
  if (hasil.length !== 1) throw new Error(`fungsi ${nama}: ${hasil.length} definisi`);
  return hasil[0];
}
const badan = (def: string) => def.slice(def.indexOf('$$') + 2, def.lastIndexOf('$$'));

// Definisi ASLI (sebelum seri ini) yang diganti migrasi dan harus dipulihkan persis oleh rollback.
const ASLI_HITUNG = stripSqlComments(baca('202607140004_security_and_automation.sql')).match(/CREATE FUNCTION public\.hitung_ikm\([\s\S]*?\$\$;/)![0];
const ASLI_VIEW = stripSqlComments(baca('202610090001_rbac_tahap1.sql')).match(/CREATE OR REPLACE VIEW public\.v_skm_petugas AS[\s\S]*?(?=;)/)![0];

const HITUNG = ambilFungsi(sql, 'hitung_ikm');
const R_IKM = ambilFungsi(sql, 'ringkasan_ikm');
const R_SPAK = ambilFungsi(sql, 'ringkasan_spak');
const R_RR = ambilFungsi(sql, 'ringkasan_response_rate');
const FUNGSI = { hitung_ikm: HITUNG, ringkasan_ikm: R_IKM, ringkasan_spak: R_SPAK, ringkasan_response_rate: R_RR };

const KOLOM_BARU = ['u10_transparansi', 'u11_integritas', 'versi', 'sumber', 'unit', 'jenis_kelamin', 'pendidikan'];
const NAMA_CONSTRAINT = 'skm_respons_wizard_kunjungan_versi_check';

describe('survei_jawaban: berkas, urutan, atomik, aditif', () => {
  it('terdaftar di FORWARD_MIGRATION_FILES tepat setelah migrasi undangan, nomor di atas semua migrasi di luar seri', () => {
    expect(BERKAS).toMatch(/^\d{12}_[a-z0-9_]+\.sql$/);
    expect(FORWARD_MIGRATION_FILES).toContain(BERKAS);
    expect(listMigrationFiles()).toContain(BERKAS);
    const daftar = [...FORWARD_MIGRATION_FILES];
    expect(daftar).toEqual([...daftar].sort());
    expect(daftar.indexOf(BERKAS)).toBe(daftar.indexOf(BERKAS_UNDANGAN) + 1);
    const luarSeri = listMigrationFiles().filter((nama) => !/^20261(?:1020|1030)\d{3}_/.test(nama));
    for (const nama of luarSeri) expect(nama < BERKAS).toBe(true);
    expect(BERKAS > '202610260001').toBe(true);
  });

  it('tanpa BEGIN/COMMIT (berkas maupun rollback) dan terdeteksi sebagai perubahan fungsi/policy (wajib --atomic)', () => {
    expect(mengandungKontrolTransaksi(raw)).toBe(false);
    expect(mengandungKontrolTransaksi(rollbackRaw)).toBe(false);
    expect(mengubahPolicyAtauFungsi(raw)).toBe(true);
    expect(mengubahPolicyAtauFungsi(rollbackRaw)).toBe(true);
    expect(raw).toMatch(/apply-migration\.mjs supabase\/migrations\/202611020002_survei_jawaban\.sql --atomic --dry-run/);
    expect(raw).toMatch(/apply-migration\.mjs supabase\/migrations\/202611020002_survei_jawaban\.sql --atomic\s*$/m);
    expect(raw).toContain('docs/rollback-survei-jawaban-202611020002.sql');
    expect(rollbackRaw).toMatch(/apply-migration\.mjs docs\/rollback-survei-jawaban-202611020002\.sql --atomic --dry-run/);
  });

  it('aditif: tanpa DROP COLUMN/TABLE/VIEW, tanpa DELETE/TRUNCATE/INSERT, tanpa CASCADE; satu-satunya UPDATE menandai unit baris lama', () => {
    expect(sql).not.toMatch(/\bDROP\s+(?:COLUMN|TABLE|VIEW|FUNCTION)\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b|\bDELETE\s+FROM\b|\bINSERT\s+INTO\b|\bCASCADE\b/i);
    const updates = pernyataan.filter((p) => /^UPDATE\b/i.test(p));
    expect(updates).toEqual([
      "UPDATE public.skm_respons SET unit = 'layanan' WHERE layanan_id IS NOT NULL AND sumber = 'form_lama' AND unit = 'tidak_diketahui'",
    ]);
    // ALTER TABLE hanya pada dua tabel jawaban; tabel lain (kunjungan, layanan, survei_undangan) tidak diubah.
    const alter = [...sql.matchAll(/ALTER\s+TABLE\s+(?:ONLY\s+)?([\w.]+)/gi)].map((m) => m[1]);
    expect(alter.length).toBeGreaterThan(0);
    expect(alter.every((t) => t === 'public.skm_respons' || t === 'public.spak_respons')).toBe(true);
    // DROP hanya untuk objek yang dibuat migrasi ini sendiri (idempotensi): constraint wizard dan policy spak.
    const drops = pernyataan.filter((p) => /\bDROP\b/i.test(p));
    expect(drops).toEqual([
      `ALTER TABLE public.skm_respons DROP CONSTRAINT IF EXISTS ${NAMA_CONSTRAINT}`,
      'DROP POLICY IF EXISTS spak_select_staff ON public.spak_respons',
    ]);
  });

  it('prasyarat dijaga lebih dulu dengan pesan PRASYARAT (skm_respons.kunjungan_id, survei_undangan, hitung_ikm, v_skm_petugas, peran_saya, boleh_layanan)', () => {
    const awal = raw.indexOf('DO $$');
    expect(awal).toBeGreaterThanOrEqual(0);
    expect(awal).toBeLessThan(raw.indexOf('ALTER TABLE'));
    const guard = raw.slice(awal, raw.indexOf('END $$', awal));
    expect(guard).toMatch(/to_regclass\('public\.skm_respons'\)/);
    expect(guard).toMatch(/to_regclass\('public\.survei_undangan'\)/);
    expect(guard).toMatch(/to_regclass\('public\.v_skm_petugas'\)/);
    expect(guard).toMatch(/to_regprocedure\('public\.hitung_ikm\(uuid, date, date\)'\)/);
    expect(guard).toMatch(/to_regprocedure\('public\.peran_saya\(\)'\)/);
    expect(guard).toMatch(/to_regprocedure\('public\.boleh_layanan\(uuid\)'\)/);
    expect(guard).toMatch(/attname = 'kunjungan_id'/);
    expect(guard.match(/RAISE EXCEPTION 'PRASYARAT:/g)!.length).toBeGreaterThanOrEqual(5);
  });

  it('objek yang dikonsumsi memang didefinisikan migrasi sebelumnya; objek baru belum ada di migrasi lain', () => {
    const lama = listMigrationFiles().filter((nama) => nama < BERKAS);
    const semuaLama = lama.map((nama) => stripSqlComments(baca(nama))).join('\n');
    expect(semuaLama).toMatch(/CREATE\s+FUNCTION\s+public\.hitung_ikm\(p_layanan_id uuid, p_start date, p_end date\)/i);
    expect(semuaLama).toMatch(/CREATE\s+OR\s+REPLACE\s+VIEW\s+public\.v_skm_petugas/i);
    expect(semuaLama).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.peran_saya\(\)/i);
    expect(semuaLama).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.boleh_layanan\(p_layanan uuid\)/i);
    expect(semuaLama).toMatch(/ALTER TABLE public\.skm_respons\s+ADD COLUMN IF NOT EXISTS kunjungan_id uuid/i);
    expect(semuaLama).toMatch(/CREATE TABLE IF NOT EXISTS public\.survei_undangan/i);
    expect(semuaLama).not.toMatch(/spak_respons|ringkasan_ikm|ringkasan_spak|ringkasan_response_rate|u10_transparansi|u11_integritas/i);
  });
});

describe('survei_jawaban: skm_respons diperluas', () => {
  const tambah = pernyataan.find((p) => /^ALTER TABLE public\.skm_respons ADD COLUMN IF NOT EXISTS u10_transparansi\b/i.test(p));

  it('ADD COLUMN IF NOT EXISTS untuk ketujuh kolom baru, tipe/default/CHECK persis kontrak', () => {
    expect(tambah).toBeDefined();
    const t = tambah!;
    expect(t.match(/ADD COLUMN/gi)).toHaveLength(KOLOM_BARU.length);
    expect(t.match(/ADD COLUMN IF NOT EXISTS/gi)).toHaveLength(KOLOM_BARU.length);
    expect(t).toMatch(/ADD COLUMN IF NOT EXISTS u10_transparansi smallint CHECK \(u10_transparansi BETWEEN 1 AND 4\)(?! NOT NULL)/);
    expect(t).toMatch(/ADD COLUMN IF NOT EXISTS u11_integritas smallint CHECK \(u11_integritas BETWEEN 1 AND 4\)(?! NOT NULL)/);
    expect(t).toMatch(/ADD COLUMN IF NOT EXISTS versi smallint NOT NULL DEFAULT 1(?: CHECK|,|$)/);
    expect(t).toMatch(/ADD COLUMN IF NOT EXISTS sumber text NOT NULL DEFAULT 'form_lama' CHECK \(sumber IN \('form_lama', 'wizard', 'impor'\)\)/);
    expect(t).toMatch(/ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT 'tidak_diketahui' CHECK \(unit IN \('layanan', 'fo', 'tidak_diketahui'\)\)/);
    expect(t).toMatch(/ADD COLUMN IF NOT EXISTS jenis_kelamin text(?:,|$)/);
    expect(t).toMatch(/ADD COLUMN IF NOT EXISTS pendidikan text$/);
    // Tidak ada kolom baru selain tujuh itu.
    const nama = [...t.matchAll(/ADD COLUMN IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
    expect(nama).toEqual(KOLOM_BARU);
  });

  it('constraint wizard: sumber <> wizard ATAU (kunjungan_id terisi DAN versi = 2); DROP IF EXISTS tepat sebelum ADD (idempoten)', () => {
    const iDrop = pernyataan.indexOf(`ALTER TABLE public.skm_respons DROP CONSTRAINT IF EXISTS ${NAMA_CONSTRAINT}`);
    expect(iDrop).toBeGreaterThanOrEqual(0);
    expect(pernyataan[iDrop + 1]).toBe(
      `ALTER TABLE public.skm_respons ADD CONSTRAINT ${NAMA_CONSTRAINT} CHECK (sumber <> 'wizard' OR (kunjungan_id IS NOT NULL AND versi = 2))`,
    );
    // Constraint hanya boleh dibuat SETELAH kolomnya ada.
    expect(iDrop).toBeGreaterThan(pernyataan.indexOf(tambah!));
  });

  it('baris lama ber-layanan_id ditandai unit layanan SETELAH kolom unit ada; yang tanpa layanan_id tidak disentuh', () => {
    const iUpdate = pernyataan.findIndex((p) => /^UPDATE public\.skm_respons\b/.test(p));
    expect(iUpdate).toBeGreaterThan(pernyataan.indexOf(tambah!));
    expect(pernyataan[iUpdate]).toMatch(/WHERE layanan_id IS NOT NULL AND sumber = 'form_lama' AND unit = 'tidak_diketahui'$/);
  });

  it('visit_id dan saran diberi komentar "tidak dipakai alur baru"; tidak ada komentar untuk kolom lain', () => {
    const komentar = pernyataan.filter((p) => /^COMMENT ON COLUMN public\.skm_respons\./.test(p));
    expect(komentar.map((k) => k.match(/COMMENT ON COLUMN public\.skm_respons\.(\w+)/)![1]).sort()).toEqual(['saran', 'visit_id']);
    for (const k of komentar) expect(k).toMatch(/tidak dipakai alur baru/);
  });

  it('policy skm_select_staff, hak, dan RLS tabel skm_respons tidak disentuh', () => {
    expect(sql).not.toMatch(/\bPOLICY\b[^;]*\bskm_respons\b/i);
    expect(sql).not.toMatch(/\b(?:ENABLE|DISABLE|FORCE)\s+ROW\s+LEVEL\s+SECURITY\b[^;]*skm_respons/i);
    expect(pernyataan.filter((p) => /^(?:GRANT|REVOKE)\b[^;]*\bskm_respons\b/i.test(p))).toEqual([]);
    expect(sql).not.toMatch(/\bTRIGGER\b/i); // skm_response_rate dan trg_skm_insert_rr tetap apa adanya
  });
});

describe('survei_jawaban: spak_respons (tabel, RLS, hak)', () => {
  const tabel = pernyataan.find((p) => /^CREATE TABLE (?:IF NOT EXISTS )?public\.spak_respons\b/i.test(p));

  it('CREATE TABLE memuat semua kolom, tipe, default, FK, dan CHECK persis kontrak', () => {
    expect(tabel).toBeDefined();
    const t = tabel!;
    expect(t).toMatch(/^CREATE TABLE IF NOT EXISTS public\.spak_respons\b/i);
    expect(t).toMatch(/\bid uuid PRIMARY KEY DEFAULT (?:pg_catalog\.)?gen_random_uuid\(\)/i);
    expect(t).toMatch(/\bkunjungan_id uuid UNIQUE REFERENCES public\.kunjungan \(id\) ON DELETE SET NULL/i);
    expect(t).toMatch(/\blayanan_id uuid REFERENCES public\.layanan \(id\) ON DELETE SET NULL/i);
    expect(t).toMatch(/\bunit text NOT NULL CHECK \(unit IN \('layanan', 'fo', 'tidak_diketahui'\)\)/i);
    expect(t).toMatch(/\bsumber text NOT NULL CHECK \(sumber IN \('wizard', 'impor'\)\)/i);
    for (const p of ['p1_tanpa_diskriminasi', 'p2_tanpa_kecurangan', 'p3_tanpa_imbalan', 'p4_tanpa_pungli', 'p5_tanpa_percaloan']) {
      expect(t).toMatch(new RegExp(`\\b${p} smallint NOT NULL CHECK \\(${p} BETWEEN 1 AND 6\\)`, 'i'));
    }
    expect(t).toMatch(/\bjenis_kelamin text(?: NOT NULL)?[,)]/i);
    expect(t).not.toMatch(/\bjenis_kelamin text NOT NULL/i);
    expect(t).not.toMatch(/\bpendidikan text NOT NULL/i);
    expect(t).toMatch(/\bcreated_at timestamptz NOT NULL DEFAULT (?:pg_catalog\.)?now\(\)/i);
    // Persis lima butir SPAK (p1..p5) dan tidak ada kolom identitas (nama, HP, email).
    expect([...t.matchAll(/\b(p\d)_\w+ smallint/g)].map((m) => m[1])).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(t).not.toMatch(/\b(?:nama|kontak|email|hp)\b/i);
  });

  it('RLS aktif; REVOKE ALL lalu GRANT SELECT hanya authenticated; tanpa hak tulis untuk klien', () => {
    const iRls = pernyataan.indexOf('ALTER TABLE public.spak_respons ENABLE ROW LEVEL SECURITY');
    const iRevoke = pernyataan.indexOf('REVOKE ALL ON TABLE public.spak_respons FROM PUBLIC, anon, authenticated');
    const iGrant = pernyataan.indexOf('GRANT SELECT ON TABLE public.spak_respons TO authenticated');
    expect(iRls).toBeGreaterThan(pernyataan.indexOf(tabel!));
    expect(iRevoke).toBeGreaterThanOrEqual(0);
    expect(iGrant).toBe(iRevoke + 1);
    expect(sql).not.toMatch(/GRANT\s+(?:ALL|INSERT|UPDATE|DELETE|TRUNCATE)\b[^;]*\bspak_respons\b/i);
  });

  it('TEPAT satu policy: spak_select_staff FOR SELECT TO authenticated, hanya admin/front_office lewat peran_saya(); petugas tidak ikut', () => {
    const policy = pernyataan.filter((p) => /^CREATE POLICY\b/i.test(p));
    expect(policy).toEqual([
      "CREATE POLICY spak_select_staff ON public.spak_respons FOR SELECT TO authenticated USING (public.peran_saya() IN ('admin', 'front_office'))",
    ]);
    expect(policy.join(' ')).not.toMatch(/petugas/);
    const iDrop = pernyataan.indexOf('DROP POLICY IF EXISTS spak_select_staff ON public.spak_respons');
    expect(pernyataan[iDrop + 1]).toBe(policy[0]); // idempoten
    // Semua policy baru TO authenticated (aturan global); tidak ada FOR INSERT/UPDATE/DELETE/ALL.
    for (const p of policy) expect(p).toMatch(/\bTO authenticated\b/);
    expect(sql).not.toMatch(/\bFOR\s+(?:INSERT|UPDATE|DELETE|ALL)\b/i);
  });
});

describe('survei_jawaban: fungsi SECURITY DEFINER dan hak EXECUTE', () => {
  it('jumlah SECURITY DEFINER = jumlah CREATE FUNCTION = 4, dan semuanya memakai search_path tetap', () => {
    const buat = sql.match(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/gi) ?? [];
    const definer = sql.match(/\bSECURITY DEFINER\b/gi) ?? [];
    expect(buat).toHaveLength(4);
    expect(definer).toHaveLength(buat.length);
    expect(sql.match(/SET search_path = pg_catalog, public/gi)).toHaveLength(buat.length);
    for (const [nama, def] of Object.entries(FUNGSI)) {
      expect(def, nama).toMatch(/\bSECURITY DEFINER\b/i);
      expect(def, nama).toMatch(/SET search_path = pg_catalog, public/i);
      expect(def, nama).toMatch(/\bSTABLE\b/i);
    }
  });

  it('hak EXECUTE persis: hitung_ikm anon+authenticated (tidak berubah); tiga ringkasan hanya authenticated; REVOKE mendahului GRANT', () => {
    const grants = pernyataan.filter((p) => /^GRANT\b/i.test(p)).sort();
    expect(grants).toEqual(
      [
        'GRANT EXECUTE ON FUNCTION public.hitung_ikm(uuid, date, date) TO anon, authenticated',
        'GRANT EXECUTE ON FUNCTION public.ringkasan_ikm(date, date) TO authenticated',
        'GRANT EXECUTE ON FUNCTION public.ringkasan_response_rate(date, date) TO authenticated',
        'GRANT EXECUTE ON FUNCTION public.ringkasan_spak(date, date) TO authenticated',
        'GRANT SELECT ON TABLE public.spak_respons TO authenticated',
        'GRANT SELECT ON public.v_skm_petugas TO authenticated',
      ].sort(),
    );
    const revoke = pernyataan.filter((p) => /^REVOKE\b/i.test(p)).sort();
    expect(revoke).toEqual(
      [
        'REVOKE EXECUTE ON FUNCTION public.hitung_ikm(uuid, date, date) FROM PUBLIC, anon, authenticated',
        'REVOKE ALL ON FUNCTION public.ringkasan_ikm(date, date) FROM PUBLIC, anon, authenticated',
        'REVOKE ALL ON FUNCTION public.ringkasan_response_rate(date, date) FROM PUBLIC, anon, authenticated',
        'REVOKE ALL ON FUNCTION public.ringkasan_spak(date, date) FROM PUBLIC, anon, authenticated',
        'REVOKE ALL ON TABLE public.spak_respons FROM PUBLIC, anon, authenticated',
        'REVOKE ALL ON public.v_skm_petugas FROM PUBLIC, anon, authenticated',
      ].sort(),
    );
    for (const g of pernyataan.filter((p) => /^GRANT\b/i.test(p))) {
      const objek = g.split(' TO ')[0].replace(/^GRANT\s+/i, '');
      const iGrant = pernyataan.indexOf(g);
      const iRevoke = pernyataan.findIndex((p) => /^REVOKE\b/i.test(p) && p.replace(/^REVOKE\s+(?:ALL|EXECUTE)\s+ON\s+/i, '').split(' FROM ')[0] === objek.replace(/^(?:EXECUTE|SELECT) ON\s+/i, ''));
      expect(iRevoke, g).toBeGreaterThanOrEqual(0);
      expect(iRevoke, g).toBeLessThan(iGrant);
    }
  });
});

describe('survei_jawaban: hitung_ikm (signature sama, rumus 9/10/11 unsur)', () => {
  const lama = rapikan(ASLI_HITUNG);
  const baru = rapikan(HITUNG);
  const ekor = (s: string) => s.slice(s.indexOf('FROM public.skm_respons'));

  it('signature, RETURNS TABLE, LANGUAGE/STABLE/SECURITY DEFINER, dan search_path IDENTIK dengan versi asli', () => {
    const kepala = (s: string) => s.slice(s.indexOf('(p_layanan_id'), s.indexOf('AS $$'));
    expect(kepala(baru)).toBe(kepala(lama));
    expect(baru).toMatch(/^CREATE OR REPLACE FUNCTION public\.hitung_ikm\(p_layanan_id uuid, p_start date, p_end date\) RETURNS TABLE \(layanan_id uuid, layanan_nama text, ikm numeric, responden integer\)/);
  });

  it('klausa FROM/JOIN/WHERE/GROUP BY identik dengan asli: filter layanan dan periode created_at tidak berubah, responden tetap count(*)', () => {
    expect(ekor(baru)).toBe(ekor(lama));
    expect(baru).toMatch(/pg_catalog\.count\(\*\)::integer AS responden/);
    expect(baru).toMatch(/response\.created_at::date BETWEEN p_start AND p_end/);
  });

  it('rata-rata per baris: jumlah u1..u9 + COALESCE(u10, 0) + COALESCE(u11, 0), dibagi (9.0 + u10 terisi + u11 terisi), x 25 (penyebut NUMERIK)', () => {
    const isi = badan(HITUNG);
    for (const kolom of ['u1_persyaratan', 'u2_prosedur', 'u3_waktu', 'u4_biaya', 'u5_produk', 'u6_kompetensi', 'u7_perilaku', 'u8_sarana', 'u9_pengaduan']) {
      expect(isi).toContain(`response.${kolom}`);
    }
    expect(isi).toMatch(/COALESCE\(response\.u10_transparansi, 0\)/);
    expect(isi).toMatch(/COALESCE\(response\.u11_integritas, 0\)/);
    expect(rapikan(isi)).toMatch(
      /\/ \(9\.0 \+ \(response\.u10_transparansi IS NOT NULL\)::int \+ \(response\.u11_integritas IS NOT NULL\)::int\)\s*\) \* 25 AS ikm/,
    );
    // Penyebut harus numerik (9.0), bukan bilangan bulat: pembagian bulat akan memotong 28/9 menjadi 3.
    expect(isi).not.toMatch(/\/\s*\(\s*9\s*\+/);
    // Unsur 1..9 tidak diberi COALESCE: baris dengan salah satunya kosong tetap keluar dari rata-rata (perilaku lama).
    expect(isi).not.toMatch(/COALESCE\(response\.u[1-9]_/);
  });

  it('GRANT/REVOKE disalin dari asli (EXECUTE tetap anon, authenticated)', () => {
    expect(pernyataan).toContain('REVOKE EXECUTE ON FUNCTION public.hitung_ikm(uuid, date, date) FROM PUBLIC, anon, authenticated');
    expect(pernyataan).toContain('GRANT EXECUTE ON FUNCTION public.hitung_ikm(uuid, date, date) TO anon, authenticated');
  });
});

describe('survei_jawaban: ringkasan_ikm', () => {
  const def = rapikan(R_IKM);
  const isi = rapikan(badan(R_IKM));

  it('signature (date, date) RETURNS TABLE (layanan_id, unit, nama, ikm, responden) dan hanya MEMBACA', () => {
    expect(def).toMatch(/^CREATE OR REPLACE FUNCTION public\.ringkasan_ikm\(p_start date, p_end date\) RETURNS TABLE \(layanan_id uuid, unit text, nama text, ikm numeric, responden integer\)/);
    expect(isi).not.toMatch(/\bINSERT\b|\bUPDATE\b|\bDELETE\b/i);
  });

  it('penjaga peran: admin/front_office/petugas, selain itu hasil kosong (tanpa RAISE); periode memakai tanggal WIB', () => {
    expect(isi).toMatch(/WHERE \(SELECT public\.peran_saya\(\)\) IN \('admin', 'front_office', 'petugas'\)/);
    expect(isi).not.toMatch(/RAISE/i);
    expect(isi).toMatch(/\(s\.created_at AT TIME ZONE 'Asia\/Jakarta'\)::date BETWEEN p_start AND p_end/);
  });

  it('rumus sama dengan hitung_ikm (per baris, penyebut 9.0 + unsur terisi, x 25), count(*) untuk responden', () => {
    expect(rapikan(isi)).toMatch(/\/ \(9\.0 \+ \(s\.u10_transparansi IS NOT NULL\)::int \+ \(s\.u11_integritas IS NOT NULL\)::int\)/);
    expect(isi).toMatch(/COALESCE\(s\.u10_transparansi, 0\)/);
    expect(isi).toMatch(/COALESCE\(s\.u11_integritas, 0\)/);
    expect(isi).toMatch(/pg_catalog\.avg\(b\.rata\) \* 25/);
    expect(isi).toMatch(/pg_catalog\.count\(\*\)::integer/);
  });

  it("pengelompokan: unit 'fo' -> Front Office; layanan_id terisi -> baris layanan; selain itu 'Tidak terklasifikasi (data lama/impor)' (NULL tidak bercampur dengan FO)", () => {
    expect(rapikan(isi)).toMatch(/CASE WHEN s\.unit = 'fo' THEN 'fo' WHEN s\.layanan_id IS NOT NULL THEN 'layanan' ELSE 'tidak_diketahui' END/);
    expect(isi).toContain("'Front Office'");
    expect(isi).toContain("'Tidak terklasifikasi (data lama/impor)'");
    expect(isi).toMatch(/LEFT JOIN public\.layanan AS l ON l\.id = /);
    expect(isi).toMatch(/GROUP BY/);
    expect(isi).toMatch(/ORDER BY/);
  });
});

describe('survei_jawaban: ringkasan_spak', () => {
  const def = rapikan(R_SPAK);
  const isi = rapikan(badan(R_SPAK));

  it('signature (date, date) RETURNS TABLE (layanan_id, unit, nama, responden, p1..p5) dan hanya MEMBACA', () => {
    expect(def).toMatch(/^CREATE OR REPLACE FUNCTION public\.ringkasan_spak\(p_start date, p_end date\) RETURNS TABLE \(layanan_id uuid, unit text, nama text, responden integer, p1 numeric, p2 numeric, p3 numeric, p4 numeric, p5 numeric\)/);
    expect(isi).not.toMatch(/\bINSERT\b|\bUPDATE\b|\bDELETE\b/i);
  });

  it('hanya admin/front_office (petugas TIDAK ada), selain itu kosong; periode WIB; membaca spak_respons', () => {
    expect(isi).toMatch(/WHERE \(SELECT public\.peran_saya\(\)\) IN \('admin', 'front_office'\)/);
    expect(isi).not.toMatch(/petugas/);
    expect(isi).not.toMatch(/RAISE/i);
    expect(isi).toMatch(/\(s\.created_at AT TIME ZONE 'Asia\/Jakarta'\)::date BETWEEN p_start AND p_end/);
    expect(isi).toMatch(/FROM public\.spak_respons AS s/);
  });

  it('rata-rata per butir p1..p5 dari kolom yang sesuai; pengelompokan sama dengan ringkasan_ikm', () => {
    const pasangan: [string, string][] = [['p1', 'p1_tanpa_diskriminasi'], ['p2', 'p2_tanpa_kecurangan'], ['p3', 'p3_tanpa_imbalan'], ['p4', 'p4_tanpa_pungli'], ['p5', 'p5_tanpa_percaloan']];
    for (const [alias, kolom] of pasangan) expect(isi).toMatch(new RegExp(`pg_catalog\\.avg\\(b\\.${kolom}\\) AS ${alias}\\b`));
    expect(rapikan(isi)).toMatch(/CASE WHEN s\.unit = 'fo' THEN 'fo' WHEN s\.layanan_id IS NOT NULL THEN 'layanan' ELSE 'tidak_diketahui' END/);
    expect(isi).toContain("'Front Office'");
    expect(isi).toContain("'Tidak terklasifikasi (data lama/impor)'");
  });
});

describe('survei_jawaban: ringkasan_response_rate', () => {
  const def = rapikan(R_RR);
  const isi = rapikan(badan(R_RR));

  it('signature (date, date) RETURNS TABLE (layanan_id, unit, nama, diundang, mengisi) dan hanya MEMBACA', () => {
    expect(def).toMatch(/^CREATE OR REPLACE FUNCTION public\.ringkasan_response_rate\(p_start date, p_end date\) RETURNS TABLE \(layanan_id uuid, unit text, nama text, diundang integer, mengisi integer\)/);
    expect(isi).not.toMatch(/\bINSERT\b|\bUPDATE\b|\bDELETE\b/i);
  });

  it('dari survei_undangan: diundang = undangan yang dibuat_pada-nya dalam periode WIB; mengisi = yang diisi_pada terisi; hanya admin/front_office', () => {
    expect(isi).toMatch(/FROM public\.survei_undangan AS u/);
    expect(isi).toMatch(/\(u\.dibuat_pada AT TIME ZONE 'Asia\/Jakarta'\)::date BETWEEN p_start AND p_end/);
    expect(isi).toMatch(/u\.diisi_pada IS NOT NULL/);
    expect(isi).toMatch(/WHERE \(SELECT public\.peran_saya\(\)\) IN \('admin', 'front_office'\)/);
    expect(isi).not.toMatch(/petugas/);
    expect(isi).not.toMatch(/skm_response_rate/); // tabel agregat lama tidak dipakai (spec 4.2)
    expect(isi).toMatch(/pg_catalog\.count\(\*\)::integer AS diundang/);
    expect(isi).toMatch(/FILTER \(WHERE b\.terisi\)/);
  });

  it('baris per layanan, satu baris unit fo, dan sisanya (layanan terhapus) ke tidak terklasifikasi supaya jumlah tidak hilang', () => {
    expect(rapikan(isi)).toMatch(/CASE WHEN u\.unit = 'fo' THEN 'fo' WHEN u\.layanan_id IS NOT NULL THEN 'layanan' ELSE 'tidak_diketahui' END/);
    expect(isi).toContain("'Front Office'");
    expect(isi).toContain("'Tidak terklasifikasi (data lama/impor)'");
  });
});

describe('survei_jawaban: view v_skm_petugas', () => {
  const view = pernyataan.find((p) => /^CREATE OR REPLACE VIEW public\.v_skm_petugas\b/i.test(p));
  const daftarKolom = (v: string) =>
    v
      .slice(v.search(/\bSELECT\b/i) + 6, v.search(/\bFROM\b/i))
      .split(',')
      .map((k) => k.trim().replace(/^s\./, ''));

  it('kolom lama TETAP berurutan, lalu u10_transparansi dan u11_integritas di AKHIR (CREATE OR REPLACE VIEW hanya boleh menambah di akhir)', () => {
    expect(view).toBeDefined();
    const lama = daftarKolom(rapikan(ASLI_VIEW));
    expect(lama).toHaveLength(12);
    expect(daftarKolom(view!)).toEqual([...lama, 'u10_transparansi', 'u11_integritas']);
  });

  it('tanpa identitas: tidak ada id, visit_id, kunjungan_id, unit, sumber, versi, jenis_kelamin, pendidikan', () => {
    const kolom = daftarKolom(view!);
    for (const terlarang of ['id', 'visit_id', 'kunjungan_id', 'unit', 'sumber', 'versi', 'jenis_kelamin', 'pendidikan']) {
      expect(kolom).not.toContain(terlarang);
    }
  });

  it('klausa FROM/WHERE identik dengan asli (petugas saja, disaring boleh_layanan); tanpa security_invoker (pola lama)', () => {
    const ekor = (v: string) => v.slice(v.search(/\bFROM\b/i));
    expect(ekor(view!)).toBe(ekor(rapikan(ASLI_VIEW)));
    expect(view).not.toMatch(/security_invoker|security_barrier/i);
    expect(view).toMatch(/WHERE public\.peran_saya\(\) = 'petugas' AND public\.boleh_layanan\(s\.layanan_id\)$/);
  });

  it('hak: REVOKE dari PUBLIC/anon/authenticated lalu GRANT SELECT hanya authenticated, tepat sesudah view', () => {
    const iView = pernyataan.indexOf(view!);
    expect(pernyataan[iView + 1]).toBe('REVOKE ALL ON public.v_skm_petugas FROM PUBLIC, anon, authenticated');
    expect(pernyataan[iView + 2]).toBe('GRANT SELECT ON public.v_skm_petugas TO authenticated');
  });

  it('view dibuat SETELAH kolom u10/u11 ada', () => {
    expect(pernyataan.indexOf(view!)).toBeGreaterThan(pernyataan.findIndex((p) => /ADD COLUMN IF NOT EXISTS u10_transparansi/.test(p)));
  });
});

describe('survei_jawaban: rollback', () => {
  const urut = (re: RegExp) => pernyataanRollback.findIndex((p) => re.test(p));
  const iGuard = urut(/^DO \$\$/);
  const iHitung = urut(/^CREATE OR REPLACE FUNCTION public\.hitung_ikm\b/);
  const iDropView = urut(/^DROP VIEW IF EXISTS public\.v_skm_petugas$/);
  const iCreateView = urut(/^CREATE VIEW public\.v_skm_petugas\b/);
  const iDropKolom = urut(/^ALTER TABLE public\.skm_respons DROP COLUMN\b/);

  it('penjaga DO di urutan PERTAMA dan satu-satunya', () => {
    expect(iGuard).toBe(0);
    expect(pernyataanRollback.filter((p) => /^DO\b/.test(p))).toHaveLength(1);
  });

  it('urutan aman: pulihkan hitung_ikm dan v_skm_petugas LEBIH DULU, baru hapus fungsi ringkasan, tabel spak, dan kolom', () => {
    const iRingkasan = [
      urut(/^DROP FUNCTION IF EXISTS public\.ringkasan_response_rate\(date, date\)$/),
      urut(/^DROP FUNCTION IF EXISTS public\.ringkasan_spak\(date, date\)$/),
      urut(/^DROP FUNCTION IF EXISTS public\.ringkasan_ikm\(date, date\)$/),
    ];
    const iTabel = urut(/^DROP TABLE IF EXISTS public\.spak_respons$/);
    const iConstraint = urut(new RegExp(`^ALTER TABLE public\\.skm_respons DROP CONSTRAINT IF EXISTS ${NAMA_CONSTRAINT}$`));
    for (const i of [iHitung, iDropView, iCreateView, ...iRingkasan, iTabel, iConstraint, iDropKolom]) expect(i).toBeGreaterThan(0);
    expect(iHitung).toBeLessThan(iDropKolom);
    expect(iDropView).toBeLessThan(iCreateView);
    expect(iCreateView).toBeLessThan(iDropKolom); // view lama tidak lagi bergantung pada u10/u11 saat kolom dibuang
    expect(iConstraint).toBeLessThan(iDropKolom);
    expect(Math.max(...iRingkasan)).toBeLessThan(iTabel);
    expect(iTabel).toBeLessThan(iDropKolom);
  });

  it('hitung_ikm dipulihkan PERSIS versi asli (202607140004) beserta grant/revoke-nya', () => {
    const dipulihkan = pernyataanRollback[iHitung];
    expect(dipulihkan).toBe(tanpaTitikKoma(ASLI_HITUNG).replace(/^CREATE FUNCTION/, 'CREATE OR REPLACE FUNCTION'));
    expect(pernyataanRollback).toContain('REVOKE EXECUTE ON FUNCTION public.hitung_ikm(uuid, date, date) FROM PUBLIC, anon, authenticated');
    expect(pernyataanRollback).toContain('GRANT EXECUTE ON FUNCTION public.hitung_ikm(uuid, date, date) TO anon, authenticated');
  });

  it('v_skm_petugas dipulihkan PERSIS versi asli (202610090001) lewat DROP lalu CREATE (kolom tidak bisa dibuang oleh CREATE OR REPLACE), hak seperti asli', () => {
    expect(pernyataanRollback[iCreateView]).toBe(rapikan(ASLI_VIEW).replace(/^CREATE OR REPLACE VIEW/, 'CREATE VIEW'));
    expect(pernyataanRollback[iCreateView + 1]).toBe('REVOKE ALL ON public.v_skm_petugas FROM PUBLIC, anon, authenticated');
    expect(pernyataanRollback[iCreateView + 2]).toBe('GRANT SELECT ON public.v_skm_petugas TO authenticated');
  });

  it('hanya menghapus yang ditambahkan: kolom, constraint, tabel, dan fungsi sama dengan yang dibuat migrasi; komentar dikosongkan', () => {
    const dibuatKolom = [...(pernyataan.find((p) => /ADD COLUMN/.test(p)) ?? '').matchAll(/ADD COLUMN IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
    const dihapusKolom = [...pernyataanRollback[iDropKolom].matchAll(/DROP COLUMN IF EXISTS (\w+)/g)].map((m) => m[1]);
    expect(dihapusKolom).toEqual(dibuatKolom);
    expect(pernyataanRollback[iDropKolom].match(/DROP COLUMN/g)).toHaveLength(dibuatKolom.length);
    const dibuatFungsi = [...sql.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)/gi)].map((m) => m[1]).filter((n) => n !== 'hitung_ikm').sort();
    const dihapusFungsi = [...rollback.matchAll(/DROP\s+FUNCTION\s+IF EXISTS\s+public\.(\w+)/gi)].map((m) => m[1]).sort();
    expect(dihapusFungsi).toEqual(dibuatFungsi);
    expect([...rollback.matchAll(/DROP\s+TABLE\s+IF EXISTS\s+public\.(\w+)/gi)].map((m) => m[1])).toEqual(['spak_respons']);
    expect(pernyataanRollback.filter((p) => /^COMMENT ON COLUMN/.test(p))).toEqual([
      'COMMENT ON COLUMN public.skm_respons.visit_id IS NULL',
      'COMMENT ON COLUMN public.skm_respons.saran IS NULL',
    ]);
    // Tidak menyentuh tabel lama selain skm_respons dan tidak menghapus baris.
    expect(rollback).not.toMatch(/\bDELETE\b|\bTRUNCATE\b|\bCASCADE\b|\bUPDATE\b/i);
    const alter = [...rollback.matchAll(/ALTER\s+TABLE\s+(?:ONLY\s+)?([\w.]+)/gi)].map((m) => m[1]);
    expect(alter.every((t) => t === 'public.skm_respons')).toBe(true);
  });

  it('penjaga: menolak (PRASYARAT ROLLBACK) bila fungsi public lain, selain yang di-DROP atau dipulihkan, menyebut objek baru; generik', () => {
    const awalGuard = rollback.indexOf('DO $$');
    const akhirGuard = rollback.indexOf('END $$;');
    expect(awalGuard).toBeGreaterThanOrEqual(0);
    expect(akhirGuard).toBeGreaterThan(awalGuard);
    expect(awalGuard).toBeLessThan(rollback.search(/\bDROP\b/i)); // penjaga mendahului DROP pertama
    const guard = rapikan(rollback.slice(awalGuard, akhirGuard));
    expect(guard).toMatch(/FROM pg_catalog\.pg_proc AS p JOIN pg_catalog\.pg_namespace AS n ON n\.oid = p\.pronamespace/);
    expect(guard).toMatch(/WHERE n\.nspname = 'public'/);
    const dikecualikan = guard.match(/p\.proname NOT IN \(([^)]*)\)/)?.[1].split(',').map((x) => x.trim().replace(/'/g, '')).sort();
    expect(dikecualikan).toEqual(['hitung_ikm', 'ringkasan_ikm', 'ringkasan_response_rate', 'ringkasan_spak']);
    expect(guard).toMatch(/p\.prosrc ~\* '\(spak_respons\|u10_transparansi\|u11_integritas\|ringkasan_ikm\|ringkasan_spak\|ringkasan_response_rate\)'/);
    expect(guard).toMatch(/RAISE EXCEPTION 'PRASYARAT ROLLBACK: /);
    expect(guard).toMatch(/IF v_fungsi IS NOT NULL THEN RAISE EXCEPTION/);
    // Tidak menyebut nama fungsi task lain (kirim_survei, get_survei_context, notify_kunjungan_status, ...).
    expect(guard).not.toMatch(/kirim_|get_survei|notify_kunjungan_status|submit_survei/i);
  });

  it('header menjelaskan penjaga, urutan rollback, dan peringatan data (kolom u10/u11 dan tabel spak_respons hilang)', () => {
    expect(rollbackRaw).toMatch(/TIDAK ada ketergantungan tercatat/);
    expect(rollbackRaw).toMatch(/PENJAGA/);
    expect(rollbackRaw).toMatch(/PERINGATAN/);
    expect(rollbackRaw).toMatch(/spak_respons/);
    expect(rollbackRaw).toMatch(/u10_transparansi/);
    expect(rollbackRaw).toMatch(/SEBELUM rollback 202611020001|SEBELUM rollback 0001|rollback 202611020003/);
  });
});

// Kecocokan dengan src/lib/survei/pertanyaan.ts (Task 6, ruling R2/R3): rentang CHECK di basis data, himpunan kunci, dan
// konstanta validasi RPC harus sama dengan konfigurasi yang dipakai wizard dan zod. Bila salah satu berubah sepihak,
// wizard bisa menerima nilai yang ditolak basis data (atau sebaliknya) tanpa ketahuan sampai ada pengunjung yang gagal kirim.
describe('survei_jawaban: kecocokan dengan src/lib/survei/pertanyaan.ts', () => {
  type Rentang = { min: number; max: number };

  /** Semua `<prefix><n>_nama smallint [NOT NULL] CHECK (<kolom> BETWEEN a AND b)` pada teks SQL, per kunci (p1..p5 / u1..u11). */
  function rentangPerKunci(teks: string, awalan: 'p' | 'u'): Record<string, Rentang[]> {
    const hasil: Record<string, Rentang[]> = {};
    const pola = new RegExp(String.raw`\b(${awalan}\d+)_(\w+) smallint(?: NOT NULL)? CHECK \((${awalan}\d+_\w+) BETWEEN (\d+) AND (\d+)\)`, 'gi');
    for (const m of teks.matchAll(pola)) {
      // Nama kolom di CHECK harus kolom yang sama dengan yang dideklarasikan (bukan CHECK kolom lain yang menumpang).
      expect(m[3]).toBe(`${m[1]}_${m[2]}`);
      (hasil[m[1]] ??= []).push({ min: Number(m[4]), max: Number(m[5]) });
    }
    return hasil;
  }

  const tabelSpak = pernyataan.find((p) => /^CREATE TABLE (?:IF NOT EXISTS )?public\.spak_respons\b/i.test(p))!;
  const tambahSkm = pernyataan.find((p) => /^ALTER TABLE public\.skm_respons ADD COLUMN IF NOT EXISTS u10_transparansi\b/i.test(p))!;
  // u1..u9 berasal dari baseline (tidak boleh diubah); u10 dan u11 dari migrasi ini.
  const tabelSkmAsli = rapikan(stripSqlComments(baca('202607140003_feature_schema.sql'))).match(/CREATE TABLE public\.skm_respons \([\s\S]*?\); CREATE INDEX/)![0];
  const skm = { ...rentangPerKunci(tabelSkmAsli, 'u'), ...rentangPerKunci(tambahSkm, 'u') };
  const spak = rentangPerKunci(tabelSpak, 'p');

  it('SPAK: kolom CHECK ada untuk p1..p5 saja (tepat satu CHECK per kunci) dan rentangnya = RENTANG.spak', () => {
    expect(Object.keys(spak).sort()).toEqual(PERTANYAAN_SPAK.map((p) => p.kunci).sort());
    for (const [kunci, daftar] of Object.entries(spak)) {
      expect(daftar, kunci).toEqual([RENTANG.spak]);
    }
  });

  it('SKM: kolom CHECK ada untuk u1..u11 saja (u1..u9 dari baseline, u10/u11 dari migrasi) dan rentangnya = RENTANG.skm', () => {
    expect(Object.keys(skm).sort()).toEqual(UNSUR_SKM.map((u) => u.kunci).sort());
    for (const [kunci, daftar] of Object.entries(skm)) {
      expect(daftar, kunci).toEqual([RENTANG.skm]);
    }
    // u10/u11 memang berasal dari migrasi ini, bukan dari baseline.
    expect(Object.keys(rentangPerKunci(tambahSkm, 'u')).sort()).toEqual(['u10', 'u11']);
  });

  it('kirim_survei (202611020003): kunci yang diharapkan dan batas rentang = pertanyaan.ts', () => {
    const rpc = rapikan(stripSqlComments(baca('202611020003_survei_rpc.sql')));
    const deklarasi = (nama: string) => {
      const m = rpc.match(new RegExp(`${nama} CONSTANT (?:text\\[\\]|numeric) := ([^;]+);`, 'i'));
      if (!m) throw new Error(`konstanta ${nama} tidak ditemukan di kirim_survei`);
      return m[1];
    };
    const daftarKunci = (nama: string) => [...deklarasi(nama).matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(daftarKunci('c_kunci_spak')).toEqual(PERTANYAAN_SPAK.map((p) => p.kunci));
    expect(daftarKunci('c_kunci_skm')).toEqual(UNSUR_SKM.map((u) => u.kunci));
    expect(Number(deklarasi('c_spak_min'))).toBe(RENTANG.spak.min);
    expect(Number(deklarasi('c_spak_maks'))).toBe(RENTANG.spak.max);
    expect(Number(deklarasi('c_skm_min'))).toBe(RENTANG.skm.min);
    expect(Number(deklarasi('c_skm_maks'))).toBe(RENTANG.skm.max);
  });
});

describe('survei_jawaban: pencatatan (docs/ATURAN_MIGRASI.md #4) dan skenario', () => {
  it('tercatat di MANIFEST.json', () => {
    const manifest = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'MANIFEST.json'), 'utf8'));
    expect(JSON.stringify(manifest)).toContain(BERKAS);
  });

  it('docs/MIGRATIONS.md: bagian "Survei terpadu Fase A" memuat berkas dan rollback 0002, sebelum bagian 0014', () => {
    const md = bacaDocs('MIGRATIONS.md');
    const judul = '## Survei terpadu Fase A (202611020001-202611020004)';
    expect(md).toContain(judul);
    const bagian = md.slice(md.indexOf(judul), md.indexOf('## Data walk-in lengkap (0014)'));
    expect(md.indexOf(judul)).toBeLessThan(md.indexOf('## Data walk-in lengkap (0014)'));
    expect(bagian).toContain(BERKAS);
    expect(bagian).toContain(BERKAS_ROLLBACK);
    const baris = bagian.split('\n').find((l) => l.startsWith('| 202611020002 |'));
    expect(baris).toBeDefined();
    expect(baris).toMatch(/BELUM DITERAPKAN/);
  });

  it('docs/analysis/DB-CHANGES.md: entri 0002 SESUDAH entri 0001, status DITULIS, BELUM DITERAPKAN, memuat hasil PGlite dan skenario', () => {
    const md = bacaDocs('analysis', 'DB-CHANGES.md');
    const i = md.lastIndexOf('202611020002_survei_jawaban');
    expect(i).toBeGreaterThan(md.lastIndexOf('202611020001_survei_undangan'));
    const entri = md.slice(md.lastIndexOf('\n### ', i));
    expect(entri).toContain('Status       : DITULIS, BELUM DITERAPKAN');
    expect(entri).toMatch(/PGlite/);
    expect(entri).toContain(BERKAS_ROLLBACK);
    expect(entri).toContain('skenario-survei-jawaban.mjs');
  });

  it('skenario PGlite ada dan memuat migrasi serta rollback yang diuji', () => {
    const skenario = join(MIGRATIONS_DIR, '..', '..', 'scripts', 'lokal', 'skenario-survei-jawaban.mjs');
    expect(existsSync(skenario)).toBe(true);
    const isi = readFileSync(skenario, 'utf8');
    expect(isi).toContain('202611020002_survei_jawaban.sql');
    expect(isi).toContain('rollback-survei-jawaban-202611020002.sql');
  });
});
