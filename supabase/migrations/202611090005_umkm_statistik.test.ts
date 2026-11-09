// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';
const sql = readFileSync(new URL('./202611090005_umkm_statistik.sql', import.meta.url), 'utf8');
it('statistik privat, kolektor service-only dan suka fungsional tanpa pengaturan baru', () => {
  for (const table of ['umkm_stat_suka', 'umkm_stat_total', 'umkm_stat_kejadian', 'umkm_stat_harian',
    'umkm_stat_tanpa_hasil', 'umkm_stat_bulanan', 'umkm_skor']) {
    expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
  }
  expect(sql).toContain('ON DELETE CASCADE');
  expect(sql).toContain('CREATE TRIGGER umkm_total_suka');
  expect(sql).toContain("jaga_laju('umkm_suka')");
  expect(sql).toContain("'umkm_skor_harian','0 19 * * *'");
  expect(sql).toContain("'umkm.statistik.global'");
  expect(sql).toContain('>=1000');
  expect(sql).toContain('TO service_role');
  expect(sql).not.toMatch(/GRANT\s+(SELECT|ALL)\s+ON/i);
  expect(mengandungKontrolTransaksi(sql)).toBe(false);
});
