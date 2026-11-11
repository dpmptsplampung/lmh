// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';

const baca = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : '');
const sql = baca('supabase/migrations/202611110003_umkm_cari_indeks.sql');
const lama = baca('supabase/migrations/202611100003_umkm_produk_baca.sql');
const rollback = baca('docs/rollback-umkm-cari-indeks-202611110003.sql');
const ttd = (s: string) => s.match(/CREATE OR REPLACE FUNCTION public\.umkm_cari_katalog\([\s\S]*?END \$\$;/)?.[0] ?? '';

it('mendefinisikan ulang umkm_cari_katalog dengan tanda tangan dan sifat yang sama', () => {
  const baru = ttd(sql);
  expect(baru).not.toBe('');
  const kepala = (s: string) => s.slice(0, s.indexOf('DECLARE'));
  expect(kepala(baru)).toBe(kepala(ttd(lama)));
  expect(baru).toContain('SECURITY DEFINER SET search_path = pg_catalog, pg_temp');
  expect(baru).toContain("'katalog-g3'");
});

it('hanya predikat q yang berubah: r.id IN (UNION revisi + produk), selebihnya identik', () => {
  const baru = ttd(sql);
  expect(baru).toMatch(/r\.id IN \(\s*SELECT x\.id FROM public\.umkm_revisi x/);
  expect(baru).toContain('UNION SELECT pq.revisi_id FROM public.umkm_produk pq');
  const potong = (s: string) => s.split('AND (q IS NULL OR')[0] + s.split('AND (p_jenis IS NULL')[1];
  expect(potong(baru)).toBe(potong(ttd(lama)));
});

it('membuat indeks trigram tanpa mengubah hak akses (REPLACE mempertahankan GRANT)', () => {
  for (const nama of ['umkm_katalog_spesifik', 'umkm_katalog_kategori', 'umkm_produk_nama_trgm']) {
    expect(sql).toContain(`CREATE INDEX IF NOT EXISTS ${nama}`);
    expect(rollback).toContain(`DROP INDEX IF EXISTS public.${nama}`);
  }
  expect(sql).toContain('gin_trgm_ops');
  expect(sql).not.toMatch(/\b(GRANT|REVOKE)\b/);
  expect(mengandungKontrolTransaksi(sql)).toBe(false);
});

it('rollback memuat definisi lama apa adanya', () => {
  expect(ttd(rollback)).toBe(ttd(lama));
});
