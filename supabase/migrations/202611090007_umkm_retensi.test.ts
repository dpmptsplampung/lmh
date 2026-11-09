// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';
const sql = readFileSync(new URL('./202611090007_umkm_retensi.sql', import.meta.url), 'utf8');
it('retensi berbatas, tanpa HTTP/antrean/status baru, tidak memangkas total', () => {
  for (const token of ['LIMIT 500', 'LIMIT 20000', '180 days', 'p.revisi_disetujui_id=r.id',
    '90 days', '30 days', 'TO service_role', 'DELETE FROM public.umkm_pesan_kontak',
    'DELETE FROM public.umkm_laporan', "'umkm_retensi_harian','15 19 * * *'"]) expect(sql).toContain(token);
  expect(sql).not.toMatch(/CREATE TABLE|net\.http|DELETE FROM public\.umkm_stat_total/);
  expect(sql.match(/SET search_path = pg_catalog, pg_temp AS/g))
    .toHaveLength((sql.match(/CREATE(?: OR REPLACE)? FUNCTION /g) ?? []).length);
  expect(mengandungKontrolTransaksi(sql)).toBe(false);
});
