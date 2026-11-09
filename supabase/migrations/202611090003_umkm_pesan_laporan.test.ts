// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';
const path = join(process.cwd(), 'supabase/migrations/202611090003_umkm_pesan_laporan.sql');
const sql = existsSync(path) ? readFileSync(path, 'utf8') : '';
describe('kontrak pesan/laporan privat G2', () => {
  it('tabel privat dilindungi dan guard memakai ledger laju lama', () => {
    for (const table of ['public.umkm_pesan_kontak', 'public.umkm_laporan', 'umkm_private.operasi_publik']) {
      expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`REVOKE ALL ON ${table} FROM PUBLIC, anon, authenticated, service_role`);
    }
    for (const token of ['public.anon_rate_limit', 'umkm_pesan', 'umkm_laporan', '>=200', '600',
      'check_anon_rate(p_aksi,10,600)', 'check_anon_rate(p_aksi,30,86400)',
      'auth.uid() IS NULL', 'pg_advisory_xact_lock', 'KONFLIK_OPERASI', 'nomor_tampil']) expect(sql).toContain(token);
    expect(sql).not.toContain('CREATE TABLE umkm_private.laju_publik');
  });
  it('laporan baru kembar dilindungi indeks parsial dan receipt yang sama', () => {
    expect(sql).toContain('CREATE UNIQUE INDEX umkm_laporan_kembar');
    expect(sql).toContain("coalesce(foto_id,'00000000-0000-0000-0000-000000000000'::uuid)");
    expect(sql).toContain("WHERE status='baru'");
    expect(sql).toContain('ON CONFLICT DO NOTHING RETURNING id INTO id_baru');
    expect(sql).toContain('foto_id IS NOT DISTINCT FROM foto');
  });
  it('antrean campuran dibatasi dan fungsi memiliki privilege eksplisit', () => {
    for (const fn of ['kirim_pesan_kontak', 'laporkan', 'detail_pesan', 'detail_laporan', 'ambil_pekerjaan',
      'selesaikan_pekerjaan', 'daftar_tugas']) expect(sql).toContain(`FUNCTION public.umkm_${fn}(`);
    expect(sql).toContain('UNION ALL');
    expect(sql.match(/LIMIT 21/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sql.match(/SET search_path = pg_catalog, pg_temp AS/g))
      .toHaveLength((sql.match(/CREATE(?: OR REPLACE)? FUNCTION /g) ?? []).length);
    expect(mengandungKontrolTransaksi(sql)).toBe(false);
    expect(sql).not.toMatch(/GRANT\s+(SELECT|ALL)\s+ON/i);
  });
});
