// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';
const sql = readFileSync(new URL('./202611090006_umkm_urutan.sql', import.meta.url), 'utf8');
it('urutan hanya paling sesuai, cursor terikat hari dan snapshot, hasil tetap berbatas', () => {
  for (const token of ["DEFAULT 'paling_sesuai'", 'SNAPSHOT_BERUBAH', "AT TIME ZONE 'Asia/Jakarta'",
    "'slot'", "interval '30 days'", 'LIMIT 21', 'LIMIT 10', 'p.revisi_disetujui_id']) {
    expect(sql).toContain(token);
  }
  expect(sql).not.toContain('terbaru');
  expect(sql).not.toContain('snapshot_sebelumnya');
  expect(sql.match(/SET search_path = pg_catalog, pg_temp AS/g))
    .toHaveLength((sql.match(/CREATE(?: OR REPLACE)? FUNCTION /g) ?? []).length);
  expect(mengandungKontrolTransaksi(sql)).toBe(false);
});
