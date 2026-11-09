// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';
const path = join(process.cwd(), 'supabase/migrations/202611090002_umkm_katalog.sql');
const sql = existsSync(path) ? readFileSync(path, 'utf8') : '';
describe('kontrak katalog publik G2', () => {
  it('bacaan publik dibatasi snapshot approved dan bukti unggah', () => {
    for (const token of ['umkm_cari_katalog', 'umkm_filter_katalog', 'revisi_disetujui_id',
      'unggah_etag', 'unggah_ukuran', 'r2_key_publik', 'LIMIT 21', 'gin_trgm_ops', 'extensions.hmac']) {
      expect(sql).toContain(token);
    }
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.umkm_cari_katalog/);
    expect(sql).toContain('TO anon, authenticated');
  });
  it('rencana salin tersimpan sebelum publikasi dan tidak mengantrekan pointer aktif', () => {
    for (const token of ['rencana boolean NOT NULL DEFAULT false', 'FUNCTION public.umkm_rencana_foto(',
      'FUNCTION umkm_private.foto_hapus_terbuka(', "interval '5 minutes'", 'NOT EXISTS',
      'DELETE FROM umkm_private.foto_hapus', 'foto_hapus_tertunda']) expect(sql).toContain(token);
  });
  it('antrean hapus privat dan semua fungsi terkunci', () => {
    expect(sql).toContain('ALTER TABLE umkm_private.foto_hapus ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('REVOKE ALL ON umkm_private.foto_hapus FROM PUBLIC, anon, authenticated, service_role');
    const definitions = sql.match(/CREATE(?: OR REPLACE)? FUNCTION /g) ?? [];
    expect(sql.match(/SET search_path = pg_catalog, pg_temp AS/g)).toHaveLength(definitions.length);
    expect(mengandungKontrolTransaksi(sql)).toBe(false);
    expect(sql).not.toMatch(/(?:ALTER|UPDATE|DROP)\s+(?:TABLE\s+)?public\.listing_umkm/i);
  });
});
