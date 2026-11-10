// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { KATEGORI_PER_JENIS } from '../../src/lib/umkm-katalog/taksonomi';
import { KABUPATEN_KOTA } from '../../src/lib/umkm-katalog/wilayah';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';
const read = (path: string) => existsSync(path) ? readFileSync(path, 'utf8') : '';
const sql = read('supabase/migrations/202611100001_umkm_produk_skema.sql');
const rollback = read('docs/rollback-umkm-produk-202611100001-0003.sql');
it('skema produk privat, relasi foto, label dan literal mengikuti konstanta', () => {
  for (const token of ['CREATE TABLE public.umkm_produk', 'DEFERRABLE INITIALLY DEFERRED', 'WHERE utama',
    "'Omzet lebih dari Rp50 juta per tahun'", 'SET search_path = pg_catalog, pg_temp',
    'ALTER TABLE public.umkm_produk ENABLE ROW LEVEL SECURITY',
    ...Object.values(KATEGORI_PER_JENIS).flat(), ...KABUPATEN_KOTA]) expect(sql).toContain(token);
  expect(mengandungKontrolTransaksi(sql)).toBe(false);
  expect(rollback).toContain('CREATE OR REPLACE FUNCTION umkm_private.validasi');
  expect(rollback).not.toMatch(/DROP\s+(TABLE|COLUMN)|TRUNCATE/i);
});
