// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';
const path = 'supabase/migrations/202611100002_umkm_produk_mutasi.sql';
const sql = existsSync(path) ? readFileSync(path, 'utf8') : '';
const rollback = readFileSync('docs/rollback-umkm-produk-202611100001-0003.sql', 'utf8');
it('mutasi memakai dua helper bersama dan memeriksa folder akun', () => {
  for (const token of ['umkm_private.tulis_revisi(p, d, a.id, NULL)', 'umkm_private.tulis_revisi(p, d, NULL, u)',
    "'umkm-draf/'||u::text||'/'", 'umkm_private.salin_revisi(r.id, p.versi+1, a.id,']) expect(sql).toContain(token);
  expect(sql.match(/INSERT INTO public\.umkm_revisi/g)).toHaveLength(2);
  expect(mengandungKontrolTransaksi(sql)).toBe(false);
  expect(rollback).toContain('FUNCTION umkm_private.mutasi(');
  expect(rollback).toContain('FUNCTION umkm_private.mutasi_pemilik(');
});
