// @vitest-environment node
//
// Kontrak statis migrasi 202611010001 (Fase 6: pencarian pengunjung lama untuk FO/admin).
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES } from './migration-test-utils';

const NAMA_FILE = '202611010001_fo_cari_pengunjung.sql';
const sql = readFileSync(join(__dirname, NAMA_FILE), 'utf8').replace(/\r\n/g, '\n');
const bare = sql.replace(/--[^\n]*/g, '');

function fungsi(nama: string): string {
  const mulai = bare.indexOf(`CREATE OR REPLACE FUNCTION public.${nama}(`);
  expect(mulai, `${nama} ada`).toBeGreaterThanOrEqual(0);
  const akhir = bare.indexOf('$$;', bare.indexOf('AS $$', mulai) + 5);
  expect(akhir).toBeGreaterThan(mulai);
  return bare.slice(mulai, akhir + 3);
}

describe('202611010001_fo_cari_pengunjung migration', () => {
  it('terdaftar tepat sesudah 202610310003 dan menjaga prasyarat', () => {
    const daftar = FORWARD_MIGRATION_FILES as readonly string[];
    expect(daftar.indexOf(NAMA_FILE)).toBe(daftar.indexOf('202610310003_chat_perbaikan_review.sql') + 1);
    for (const p of ['public.staf_lingkup()', 'public.sesi_valid()']) expect(bare).toContain(`to_regprocedure('${p}')`);
    expect(bare).toMatch(/extname = 'pg_trgm'/);
  });

  it('B1: aditif (tanpa DELETE/TRUNCATE/DROP TABLE|COLUMN/UPDATE/ekstensi baru)', () => {
    expect(bare).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(bare).not.toMatch(/\bTRUNCATE\b/i);
    expect(bare).not.toMatch(/\bDROP\s+(TABLE|COLUMN|SCHEMA)\b/i);
    expect(bare).not.toMatch(/\bUPDATE\s+public\./i);
    expect(bare).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(bare).not.toMatch(/CREATE\s+EXTENSION/i);
  });

  it('indeks trigram untuk nama dan HP kanonik', () => {
    expect(bare).toMatch(/CREATE INDEX IF NOT EXISTS idx_kunjungan_nama_trgm\s+ON public\.kunjungan USING gin \(nama gin_trgm_ops\)/);
    expect(bare).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_kunjungan_hp_trgm\s+ON public\.kunjungan USING gin \(\(public\.hp_normal\(kontak_hp\)\) gin_trgm_ops\)/,
    );
    expect(fungsi('hp_normal')).toMatch(/IMMUTABLE/);
  });

  for (const nama of ['fo_cari_pengunjung', 'fo_ambil_pengunjung']) {
    describe(nama, () => {
      const f = () => fungsi(nama);
      it('SECURITY DEFINER dengan search_path terkunci dan hanya FO/admin aktif dengan sesi sah', () => {
        expect(f()).toMatch(/SECURITY DEFINER\s+SET search_path = pg_catalog, public/);
        expect(f()).toContain('public.sesi_valid()');
        expect(f()).toContain('SESI_TIDAK_SAH');
        expect(f()).toMatch(/FROM public\.staf_lingkup\(\) AS me/);
        expect(f()).toMatch(/v_role NOT IN \('admin', 'front_office'\)/);
        expect(f()).toContain('FORBIDDEN');
      });
      it('mengecualikan data teranonimkan dan lewat batas retensi 730 hari (WIB)', () => {
        expect(f()).toContain("<> '[anonim]'");
        expect(f()).toMatch(/asal_instansi IS NOT NULL/);
        expect(f()).toMatch(/Asia\/Jakarta'\)::date - 730/);
        expect(f()).toMatch(/k\.tanggal >= v_batas/);
      });
      it('hak eksekusi: tanpa PUBLIC/anon, hanya authenticated', () => {
        expect(bare).toContain(`REVOKE ALL ON FUNCTION public.${nama}(${nama === 'fo_cari_pengunjung' ? 'text' : 'uuid'}) FROM PUBLIC, anon, authenticated;`);
        expect(bare).toContain(`GRANT EXECUTE ON FUNCTION public.${nama}(${nama === 'fo_cari_pengunjung' ? 'text' : 'uuid'}) TO authenticated;`);
      });
    });
  }

  it('fo_cari_pengunjung: minimal 3 di server, maks 5 baris, HP disamarkan, tidak mengembalikan email/HP penuh', () => {
    const f = fungsi('fo_cari_pengunjung');
    expect(f).toMatch(/length\(v_qd\) < 3/);
    expect(f).toMatch(/length\(v_q\) < 3/);
    expect(f.match(/LIMIT 5;/g)?.length).toBe(2);
    expect(f.match(/LIMIT 300/g)?.length).toBe(2);
    expect(f).toMatch(/left\(t\.hp, 4\) \|\| '\*\*\*\*' \|\| pg_catalog\.right\(t\.hp, 3\)/);
    expect(f).toMatch(/RETURNS TABLE \(id uuid, nama text, hp_samar text, asal_instansi text, tanggal date\)/);
    expect(f).not.toMatch(/\bemail\b/);
    expect(f).not.toMatch(/kontak_hp AS/);
    // satu baris per orang (kunjungan terkini), pembungkus LIKE dinetralkan
    expect(f.match(/DISTINCT ON/g)?.length).toBe(2);
    expect(f).toContain("'\%'");
    expect(f).toContain("'\_'");
    expect(f).toMatch(/hp_normal\(k\.kontak_hp\) LIKE '%' \|\| v_qd \|\| '%'/);
    expect(f).toMatch(/k\.nama ILIKE '%' \|\| v_pola \|\| '%'/);
  });

  it('fo_ambil_pengunjung: diaudit tanpa PII dan dibatasi 60 per 10 menit', () => {
    const f = fungsi('fo_ambil_pengunjung');
    expect(f).toMatch(/INSERT INTO public\.audit_log/);
    expect(f).toContain("'fo_ambil_pengunjung'");
    expect(f).toMatch(/jsonb_build_object\('kunjungan_id', p_id\)/);
    expect(f).toMatch(/INTERVAL '10 minutes'/);
    expect(f).toMatch(/v_jumlah >= 60/);
    expect(f).toContain('RATE_LIMIT');
    expect(f).toContain('NOT_FOUND');
    expect(f).toMatch(/RETURNS TABLE \(nama text, asal_instansi text, kategori text, email text, kontak_hp text\)/);
  });

  it('rollback hanya menghapus objek baru, indeks sebelum fungsi HP', () => {
    const rb = readFileSync(join(__dirname, '..', '..', 'docs', 'rollback-fo-cari-pengunjung-202611010001.sql'), 'utf8').replace(/--[^\n]*/g, '');
    expect(rb).toMatch(/DROP FUNCTION IF EXISTS public\.fo_ambil_pengunjung\(uuid\)/);
    expect(rb).toMatch(/DROP FUNCTION IF EXISTS public\.fo_cari_pengunjung\(text\)/);
    expect(rb.indexOf('DROP INDEX IF EXISTS public.idx_kunjungan_hp_trgm')).toBeLessThan(rb.indexOf('DROP FUNCTION IF EXISTS public.hp_normal(text)'));
    expect(rb).not.toMatch(/DROP\s+(TABLE|COLUMN)|DELETE|TRUNCATE/i);
  });
});
