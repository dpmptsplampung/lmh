// @vitest-environment node
//
// Kontrak statis migrasi 202610280001 (Fase 2: homepage etalase). Tes ini hanya membaca teks SQL;
// tidak ada SQL yang dieksekusi ke database.
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES } from './migration-test-utils';

const NAMA_FILE = '202610280001_homepage_etalase.sql';
const sql = readFileSync(join(__dirname, NAMA_FILE), 'utf8');
const bare = sql.replace(/--[^\n]*/g, '');

describe('202610280001_homepage_etalase migration', () => {
  it('menambah saklar tampil_di_homepage secara aditif (default true)', () => {
    expect(bare).toMatch(
      /ALTER TABLE public\.layanan\s+ADD COLUMN IF NOT EXISTS tampil_di_homepage boolean NOT NULL DEFAULT true/i,
    );
    expect(bare.match(/ADD COLUMN IF NOT EXISTS/gi)).toHaveLength(1);
  });

  it('v_layanan_publik menambah kolom di akhir tanpa mengubah WHERE', () => {
    const view = bare.match(/CREATE OR REPLACE VIEW public\.v_layanan_publik[\s\S]*?;/i)?.[0] ?? '';
    expect(view).toMatch(/WITH \(security_invoker = true\)/i);
    expect(view.indexOf('website_terkait')).toBeGreaterThan(-1);
    expect(view.indexOf('tampil_di_homepage')).toBeGreaterThan(view.indexOf('AS website_terkait'));
    expect(view).toMatch(/WHERE l\.aktif = true AND l\.status_tampilan <> 'nonaktif'/);
    expect(bare).toMatch(/GRANT SELECT ON public\.v_layanan_publik TO anon, authenticated/i);
  });

  it('membuat homepage_blok dengan CHECK jenis (7 jenis) dan teks berupa objek', () => {
    const tabel = bare.match(/CREATE TABLE IF NOT EXISTS public\.homepage_blok\s*\(([\s\S]*?)\n\);/i)?.[1] ?? '';
    expect(tabel).toMatch(/jenis\s+text\s+PRIMARY KEY/i);
    for (const j of ['hero', 'jalur_cepat', 'status_hari_ini', 'layanan', 'papan_kinerja', 'ajakan', 'footer']) {
      expect(tabel).toContain(`'${j}'`);
    }
    expect(tabel).toMatch(/aktif\s+boolean\s+NOT NULL/i);
    expect(tabel).toMatch(/urutan\s+integer\s+NOT NULL/i);
    expect(tabel).toMatch(/teks\s+jsonb\s+NOT NULL DEFAULT '\{\}'::jsonb CHECK \(jsonb_typeof\(teks\) = 'object'\)/i);
  });

  it('policy: baca publik USING (true); tulis admin TO authenticated', () => {
    expect(bare).toMatch(/ALTER TABLE public\.homepage_blok ENABLE ROW LEVEL SECURITY/i);
    expect(bare).toMatch(/CREATE POLICY homepage_blok_public_read ON public\.homepage_blok\s+FOR SELECT USING \(true\)/i);
    expect(bare).toMatch(
      /CREATE POLICY homepage_blok_admin_all ON public\.homepage_blok\s+FOR ALL TO authenticated\s+USING \(public\.get_my_role\(\) = 'admin'\)\s+WITH CHECK \(public\.get_my_role\(\) = 'admin'\)/i,
    );
    // Pelajaran standar_pelayanan: tidak boleh ada policy FOR ALL tanpa TO.
    expect(bare).not.toMatch(/FOR ALL\s+(USING|WITH)/i);
    expect(bare).toMatch(/GRANT SELECT ON TABLE public\.homepage_blok TO anon, authenticated/i);
    expect(bare).toMatch(/GRANT INSERT, UPDATE, DELETE ON TABLE public\.homepage_blok TO authenticated/i);
  });

  it('audit_perubahan disalin utuh dari 202610090004; satu-satunya beda: COALESCE entitas_id memuat jenis', () => {
    const ambil = (teks: string) =>
      (teks.replace(/\r\n/g, '\n').match(/CREATE OR REPLACE FUNCTION public\.audit_perubahan\(\)[\s\S]*?\$\$;/i)?.[0] ?? '');
    const asli = ambil(readFileSync(join(__dirname, '202610090004_kelola_layanan_audit.sql'), 'utf8'));
    const baru = ambil(sql);
    expect(asli).not.toBe('');
    expect(baru).not.toBe('');
    expect(baru).toContain("v_baris ->> 'key', v_baris ->> 'jenis')");
    expect(baru.replace(", v_baris ->> 'jenis')", ')')).toBe(asli);
    expect(bare).toMatch(/REVOKE ALL ON FUNCTION public\.audit_perubahan\(\) FROM PUBLIC, anon, authenticated/i);
    // Fungsi harus sudah diganti SEBELUM trigger audit homepage_blok dipasang.
    expect(sql.indexOf('FUNCTION public.audit_perubahan()')).toBeLessThan(sql.indexOf('CREATE TRIGGER trg_audit_homepage_blok'));
  });

  it('audit dan updated_at dipasang', () => {
    expect(bare).toMatch(/CREATE TRIGGER trg_audit_homepage_blok AFTER INSERT OR UPDATE OR DELETE ON public\.homepage_blok\s+FOR EACH ROW EXECUTE FUNCTION public\.audit_perubahan\(\)/i);
    expect(bare).toMatch(/CREATE TRIGGER trg_homepage_blok_updated_at\s+BEFORE UPDATE ON public\.homepage_blok[\s\S]*?update_updated_at_column\(\)/i);
  });

  it('seed: insert-if-missing, urutan bawaan, papan_kinerja mati, salinan landing_content tanpa judul layanan', () => {
    const inserts = bare.match(/INSERT INTO public\.homepage_blok[\s\S]*?ON CONFLICT \(jenis\) DO NOTHING;/gi) ?? [];
    expect(inserts.length).toBeGreaterThanOrEqual(7);
    expect(bare.match(/INSERT INTO public\.homepage_blok/gi)).toHaveLength(inserts.length);
    expect(bare).toMatch(/'papan_kinerja',\s*false/i);
    expect(bare).toMatch(/FROM public\.landing_content/i);
    // Judul bagian layanan lama ("10 Layanan ...") tidak disalin: blok layanan hanya mengambil label & description.
    const blokLayanan = inserts.find((s) => s.includes("'layanan'")) ?? '';
    expect(blokLayanan).toMatch(/item_key IN \('label', 'description'\)/);
    expect(blokLayanan).not.toMatch(/'title'/);
  });

  it('layanan_status_hari_ini memakai is_layanan_buka_jadwal, WIB, SECURITY DEFINER, EXECUTE untuk anon', () => {
    const fn = bare.match(/CREATE OR REPLACE FUNCTION public\.layanan_status_hari_ini\(\)[\s\S]*?\$\$;/i)?.[0] ?? '';
    expect(fn).toMatch(/RETURNS TABLE\s*\(\s*layanan_id\s+uuid,\s*buka_sekarang\s+boolean,\s*libur_keterangan\s+text,\s*jadwal\s+jsonb\s*\)/i);
    expect(fn).toMatch(/SECURITY DEFINER/i);
    expect(fn).toMatch(/SET search_path = pg_catalog, public/i);
    expect(fn).toMatch(/Asia\/Jakarta/);
    expect(fn).toMatch(/public\.is_layanan_buka_jadwal\(l\.id, v_hari_ini, v_jam\)/);
    // Status = KEADAAN SEKARANG (jam WIB), bukan sekadar hari: setelah jam tutup harus tutup.
    expect(fn).toMatch(/v_jam\s+time := \(now\(\) AT TIME ZONE 'Asia\/Jakarta'\)::time/);
    expect(fn).not.toMatch(/is_layanan_buka_jadwal\([^)]*NULL\)/);
    expect(fn).toMatch(/FROM public\.hari_libur/i);
    expect(fn).toMatch(/FROM public\.jadwal_standby/i);
    expect(fn).toMatch(/l\.aktif = true AND l\.status_tampilan <> 'nonaktif'/);
    expect(bare).toMatch(/REVOKE ALL ON FUNCTION public\.layanan_status_hari_ini\(\) FROM PUBLIC/i);
    expect(bare).toMatch(/GRANT EXECUTE ON FUNCTION public\.layanan_status_hari_ini\(\) TO anon, authenticated/i);
  });

  it('tidak destruktif (B1)', () => {
    // Hak GRANT dan pemicu audit menyebut DELETE/UPDATE sebagai hak/peristiwa, bukan sebagai pernyataan data.
    const pernyataan = bare
      .replace(/CREATE OR REPLACE FUNCTION public\.audit_perubahan\(\)[\s\S]*?\$\$;/i, '')
      .replace(/GRANT[^;]*;/gi, '').replace(/AFTER INSERT OR UPDATE OR DELETE ON/gi, '');
    expect(pernyataan).not.toMatch(/\b(DELETE|TRUNCATE)\b/i);
    expect(pernyataan).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
    expect(pernyataan).not.toMatch(/\bUPDATE\s+public\./i);
  });

  it('terdaftar di FORWARD_MIGRATION_FILES', () => {
    expect(FORWARD_MIGRATION_FILES).toContain(NAMA_FILE);
  });
});
