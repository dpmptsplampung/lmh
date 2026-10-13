// @vitest-environment node
// Kontrak statis migrasi 202610140006_pernyataan_kebenaran (tidak mengeksekusi SQL; tidak menyentuh database).
// Spec: docs/superpowers/specs/2026-10-12-alur-fo-eskalasi-design.md §4.9 (K12). Rollback: docs/rollback-pernyataan-kebenaran-202610140006.sql.
// Simulator di bawah mencerminkan keputusan trigger jaga_nama_pengunjung dan fungsi pengunjung_profil_lengkap;
// regex SQL yang sebenarnya diperiksa terhadap simulator agar tidak menyimpang dari aturan TypeScript.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES, MIGRATIONS_DIR, listMigrationFiles, stripSqlComments } from './migration-test-utils';
import { mengandungKontrolTransaksi, mengubahPolicyAtauFungsi } from '../../scripts/lib/sql-txn.mjs';
import { profilLengkap } from '../../src/lib/profil-pengunjung';

const BERKAS = '202610140006_pernyataan_kebenaran.sql';
const raw = readFileSync(join(MIGRATIONS_DIR, BERKAS), 'utf8');
const sql = stripSqlComments(raw);
const rollbackRaw = readFileSync(join(MIGRATIONS_DIR, '../../docs/rollback-pernyataan-kebenaran-202610140006.sql'), 'utf8');
const rollback = stripSqlComments(rollbackRaw);

/** Definisi lengkap `CREATE [OR REPLACE] FUNCTION public.<nama>(...) ... $$;`. */
function ambilFungsi(teks: string, nama: string): string {
  const m = teks.match(new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${nama}\\s*\\([\\s\\S]*?\\$\\$;`, 'i'));
  if (!m) throw new Error(`fungsi ${nama} tidak ditemukan`);
  return m[0];
}

describe('Pernyataan kebenaran: berkas dan urutan', () => {
  it('tanpa BEGIN/COMMIT, terdeteksi pembuat fungsi (wajib --atomic), perintah penerapan tertulis', () => {
    expect(mengandungKontrolTransaksi(raw)).toBe(false);
    expect(mengandungKontrolTransaksi(rollbackRaw)).toBe(false);
    expect(mengubahPolicyAtauFungsi(raw)).toBe(true);
    expect(raw).toMatch(/apply-migration\.mjs supabase\/migrations\/202610140006_pernyataan_kebenaran\.sql --atomic --dry-run/);
  });

  it('terdaftar, berpola benar, dan versinya lebih besar dari 202610140002', () => {
    expect(FORWARD_MIGRATION_FILES).toContain(BERKAS);
    expect(BERKAS).toMatch(/^\d{12}_[a-z0-9_]+\.sql$/);
    expect(listMigrationFiles()).toContain(BERKAS);
    expect(BERKAS > '202610140002_tiket_kepemilikan.sql').toBe(true);
  });

  it('penjaga prasyarat di awal: sesi_valid(), staf_saya(), pengunjung.no_hp, audit_log.nilai_baru', () => {
    const doBlok = sql.match(/DO \$\$[\s\S]*?\$\$;/)![0];
    expect(doBlok).toMatch(/to_regprocedure\('public\.sesi_valid\(\)'\)/);
    expect(doBlok).toMatch(/to_regprocedure\('public\.staf_saya\(\)'\)/);
    expect(doBlok).toMatch(/attname = 'no_hp'/);
    expect(doBlok).toMatch(/attname = 'nilai_baru'/);
    expect(sql.search(/DO \$\$/)).toBeLessThan(sql.search(/CREATE OR REPLACE FUNCTION/));
  });

  it('idempoten dan tidak menyentuh data/skema tabel: tanpa ALTER/CREATE TABLE, UPDATE/DELETE tingkat atas, consent_log, policy', () => {
    expect(sql).not.toMatch(/\bTRUNCATE\b|\bDELETE\s+FROM\b|ALTER\s+TABLE|CREATE\s+TABLE|CASCADE|CREATE\s+POLICY|DROP\s+POLICY/i);
    expect(sql).not.toMatch(/CREATE\s+FUNCTION/i);
    expect(sql).not.toMatch(/consent_log/i);
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS trg_jaga_nama_pengunjung ON public\.pengunjung;/);
    // satu-satunya UPDATE ada di dalam RPC, bukan backfill tingkat atas
    const atas = sql.replace(/\$\$[\s\S]*?\$\$/g, '');
    expect(atas).not.toMatch(/(?:^|;)\s*UPDATE\b/im);
    expect(sql).not.toMatch(/\bnik\b/i);
  });
});

describe('Pernyataan kebenaran: SECURITY DEFINER dan hak eksekusi', () => {
  it.each(['jaga_nama_pengunjung', 'ubah_nama_pengunjung'])('%s: SECURITY DEFINER, search_path terkunci', (nama) => {
    const f = ambilFungsi(sql, nama);
    expect(f).toMatch(/SECURITY DEFINER/);
    expect(f).toMatch(/SET search_path = pg_catalog, public\s/);
  });

  it('pengunjung_profil_lengkap: IMMUTABLE dengan search_path terkunci', () => {
    const f = ambilFungsi(sql, 'pengunjung_profil_lengkap');
    expect(f).toMatch(/\bIMMUTABLE\b/);
    expect(f).toMatch(/SET search_path = pg_catalog, public\s/);
  });

  it('semua fungsi di-REVOKE dari PUBLIC/anon/authenticated; hanya RPC yang di-GRANT, hanya ke authenticated', () => {
    for (const sig of [
      'pengunjung_profil_lengkap\\(text, text, text, text, text\\)',
      'jaga_nama_pengunjung\\(\\)',
      'ubah_nama_pengunjung\\(uuid, text, text\\)',
    ]) {
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig} FROM PUBLIC, anon, authenticated;`));
    }
    const grants = [...sql.matchAll(/GRANT\s[^;]*;/gi)].map((m) => m[0].replace(/\s+/g, ' '));
    expect(grants).toEqual(['GRANT EXECUTE ON FUNCTION public.ubah_nama_pengunjung(uuid, text, text) TO authenticated;']);
  });
});

describe('Pernyataan kebenaran: trigger penjaga nama', () => {
  const f = ambilFungsi(sql, 'jaga_nama_pengunjung');

  it('BEFORE UPDATE FOR EACH ROW pada public.pengunjung', () => {
    expect(sql).toMatch(
      /CREATE TRIGGER trg_jaga_nama_pengunjung\s+BEFORE UPDATE ON public\.pengunjung\s+FOR EACH ROW EXECUTE FUNCTION public\.jaga_nama_pengunjung\(\);/,
    );
  });

  it('urutan keputusan: tanpa auth.uid() lolos -> flag lmh.ubah_nama lolos -> OLD belum lengkap lolos -> nama berubah ditolak -> jadi tidak lengkap ditolak', () => {
    const urut = [
      /auth\.uid\(\) IS NULL/,
      /current_setting\('lmh\.ubah_nama', true\)/,
      /NOT public\.pengunjung_profil_lengkap\(OLD\.nama/,
      /NEW\.nama IS DISTINCT FROM OLD\.nama/,
      /NOT public\.pengunjung_profil_lengkap\(NEW\.nama/,
    ].map((re) => f.search(re));
    for (const i of urut) expect(i).toBeGreaterThan(-1);
    expect([...urut].sort((a, b) => a - b)).toEqual(urut);
    expect(f).toMatch(/NAMA_TERKUNCI[\s\S]*ERRCODE = '42501'/);
    expect(f).toMatch(/PROFIL_WAJIB_LENGKAP[\s\S]*ERRCODE = '22023'/);
  });

  it('flag lmh.ubah_nama hanya dinyalakan di ubah_nama_pengunjung (lokal transaksi) dan dimatikan lagi', () => {
    expect(f).not.toMatch(/set_config/);
    const rpc = ambilFungsi(sql, 'ubah_nama_pengunjung');
    expect(rpc).toMatch(/set_config\('lmh\.ubah_nama', 'on', true\)/);
    expect(rpc).toMatch(/set_config\('lmh\.ubah_nama', 'off', true\)/);
    expect(rpc.search(/'on', true/)).toBeLessThan(rpc.search(/UPDATE public\.pengunjung/));
    expect(rpc.search(/UPDATE public\.pengunjung/)).toBeLessThan(rpc.search(/'off', true/));
  });
});

describe('Pernyataan kebenaran: RPC ubah_nama_pengunjung', () => {
  const f = ambilFungsi(sql, 'ubah_nama_pengunjung');

  it('hanya admin/front_office aktif (staf_saya), sesi sah, alasan >= 5, nama 3..120, urutan pemeriksaan benar', () => {
    expect(f).toMatch(/staf_saya\(\)/);
    expect(f).toMatch(/v_me_role NOT IN \('admin', 'front_office'\)/);
    expect(f).toMatch(/NOT public\.sesi_valid\(\)/);
    expect(f).toMatch(/char_length\(v_alasan\) < 5/);
    expect(f).toMatch(/char_length\(v_baru\) < 3 OR pg_catalog\.char_length\(v_baru\) > 120/);
    const urut = [/FORBIDDEN/, /SESI_TIDAK_SAH/, /ALASAN_WAJIB/, /NAMA_TIDAK_VALID/, /NOT_FOUND/].map((re) => f.search(re));
    expect([...urut].sort((a, b) => a - b)).toEqual(urut);
    expect(urut.every((i) => i > -1)).toBe(true);
  });

  it('mengunci baris (FOR UPDATE) dan mencatat audit_log nilai lama -> baru beserta alasan', () => {
    expect(f).toMatch(/FROM public\.pengunjung AS v WHERE v\.id = p_pengunjung_id FOR UPDATE/);
    const audit = f.match(/INSERT INTO public\.audit_log[\s\S]*?\);/)![0];
    expect(audit).toMatch(/nilai_lama, nilai_baru/);
    expect(audit).toMatch(/'ubah_nama_pengunjung', 'pengunjung', p_pengunjung_id::text/);
    expect(audit).toMatch(/'alasan', v_alasan/);
    expect(audit).toMatch(/'nama', v_lama/);
    expect(audit).toMatch(/'nama', v_baru/);
    expect(f).toMatch(/auth\.uid\(\), v_me_role/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Simulator
// ---------------------------------------------------------------------------------------------------------------
interface Profil { nama: string; email: string | null; no_hp: string | null; asal_instansi: string | null; kategori: string | null }

/** Cermin pengunjung_profil_lengkap memakai ekspresi reguler yang SAMA dengan yang ada di SQL. */
function lengkapSql(p: Profil): boolean {
  const btrim = (s: string | null) => (s === null ? null : s.replace(/^ +| +$/g, ''));
  const nama = btrim(p.nama);
  const email = btrim(p.email);
  const hp = p.no_hp === null ? null : p.no_hp.replace(/[\s-]/g, '');
  const asal = btrim(p.asal_instansi);
  const kat = btrim(p.kategori);
  if (nama === null || email === null || hp === null || asal === null || kat === null) return false;
  return (
    nama.length >= 3
    && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
    && /^(?:\+?62|0)8[1-9][0-9]{7,12}$/.test(hp)
    && asal.length >= 1
    && ['UMKM', 'Umum', 'Instansi', 'Investor'].includes(kat)
  );
}

type Putusan = 'lolos' | 'NAMA_TERKUNCI' | 'PROFIL_WAJIB_LENGKAP';
function trigger(lama: Profil, baru: Profil, o: { uid: string | null; flag: boolean }): Putusan {
  if (o.uid === null || o.flag) return 'lolos';
  if (!lengkapSql(lama)) return 'lolos';
  if (baru.nama !== lama.nama) return 'NAMA_TERKUNCI';
  if (!lengkapSql(baru)) return 'PROFIL_WAJIB_LENGKAP';
  return 'lolos';
}

const L: Profil = { nama: 'Budi Santoso', email: 'budi@example.com', no_hp: '0812-3456-7890', asal_instansi: 'Unila', kategori: 'Umum' };
const KOSONG: Profil = { nama: 'Pengunjung', email: null, no_hp: null, asal_instansi: null, kategori: null };
const PEMILIK = { uid: 'u1', flag: false };

describe('Pernyataan kebenaran: simulator keputusan (cermin SQL)', () => {
  it('regex di simulator identik dengan yang tertulis di SQL', () => {
    const f = ambilFungsi(sql, 'pengunjung_profil_lengkap');
    expect(f).toContain(String.raw`'^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'`);
    expect(f).toContain(String.raw`'^(?:\+?62|0)8[1-9][0-9]{7,12}$'`);
    expect(f).toContain("'[[:space:]-]'");
    expect(f).toContain("IN ('UMKM', 'Umum', 'Instansi', 'Investor')");
  });

  it('simulator SQL sepakat dengan aturan TypeScript untuk profil tipikal', () => {
    const kasus: Profil[] = [
      L,
      { ...L, email: null },
      { ...L, email: 'tanpa-at' },
      { ...L, no_hp: '0217654321' },
      { ...L, no_hp: '+6281234567890' },
      { ...L, asal_instansi: '   ' },
      { ...L, kategori: 'akademisi' },
      { ...L, nama: 'Bu' },
      KOSONG,
    ];
    for (const k of kasus) expect(lengkapSql(k)).toBe(profilLengkap(k));
  });

  it('profil belum lengkap: pengisian awal bebas, termasuk mengubah nama', () => {
    expect(trigger(KOSONG, { ...L, nama: 'Nama Baru' }, PEMILIK)).toBe('lolos');
    expect(trigger({ ...L, email: null }, { ...L, nama: 'Lain Lagi' }, PEMILIK)).toBe('lolos');
  });

  it('profil lengkap: nama tidak bisa diubah pemilik (juga ubah spasi/kapital)', () => {
    expect(trigger(L, { ...L, nama: 'Budi Santoso Lain' }, PEMILIK)).toBe('NAMA_TERKUNCI');
    expect(trigger(L, { ...L, nama: 'budi santoso' }, PEMILIK)).toBe('NAMA_TERKUNCI');
  });

  it('profil lengkap: HP, email, asal, kategori tetap bisa diubah selama tetap lengkap', () => {
    expect(trigger(L, { ...L, no_hp: '081999888777' }, PEMILIK)).toBe('lolos');
    expect(trigger(L, { ...L, email: 'baru@example.org' }, PEMILIK)).toBe('lolos');
    expect(trigger(L, { ...L, asal_instansi: 'PT ABC', kategori: 'UMKM' }, PEMILIK)).toBe('lolos');
  });

  it('celah "kosongkan field lalu ubah nama" ditutup: profil lengkap tidak boleh menjadi tidak lengkap', () => {
    expect(trigger(L, { ...L, asal_instansi: '' }, PEMILIK)).toBe('PROFIL_WAJIB_LENGKAP');
    expect(trigger(L, { ...L, email: null }, PEMILIK)).toBe('PROFIL_WAJIB_LENGKAP');
    expect(trigger(L, { ...L, no_hp: '123' }, PEMILIK)).toBe('PROFIL_WAJIB_LENGKAP');
  });

  it('pengecualian: service_role/pg_cron (tanpa uid, mis. anonimisasi) dan flag RPC resmi', () => {
    expect(trigger(L, { ...L, nama: '[anonim]', email: null }, { uid: null, flag: false })).toBe('lolos');
    expect(trigger(L, { ...L, nama: 'Nama Dikoreksi FO' }, { uid: 'fo-1', flag: true })).toBe('lolos');
  });
});

describe('Pernyataan kebenaran: rollback', () => {
  it('hanya membuang trigger dan ketiga fungsi (IF EXISTS), tanpa menyentuh data', () => {
    expect(rollback).toMatch(/DROP TRIGGER IF EXISTS trg_jaga_nama_pengunjung ON public\.pengunjung;/);
    for (const sig of ['ubah_nama_pengunjung\\(uuid, text, text\\)', 'jaga_nama_pengunjung\\(\\)', 'pengunjung_profil_lengkap\\(text, text, text, text, text\\)']) {
      expect(rollback).toMatch(new RegExp(`DROP FUNCTION IF EXISTS public\\.${sig};`));
    }
    expect(rollback).not.toMatch(/\bDELETE\b|\bUPDATE\b|\bTRUNCATE\b|DROP\s+TABLE|CASCADE/i);
    expect(rollbackRaw).toMatch(/--atomic --dry-run/i);
    // urutan: trigger dulu sebelum fungsinya
    expect(rollback.search(/DROP TRIGGER/)).toBeLessThan(rollback.search(/DROP FUNCTION/));
  });
});
