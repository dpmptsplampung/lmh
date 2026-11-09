// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';
it('pemilik punya RLS, satu pelaku, hak dari UID dan revisi tanpa mengubah snapshot terbit', () => {
  const sql = readFileSync(new URL('./202611090010_umkm_pemilik.sql', import.meta.url), 'utf8');
  for (const token of ['CREATE TABLE public.umkm_pemilik', 'ENABLE ROW LEVEL SECURITY',
    'num_nonnulls(dibuat_oleh,aktor_uid)=1', 'num_nonnulls(aktor_id,aktor_uid)=1',
    'umkm_private.akun_suka()', 'FOR UPDATE', 'KONFLIK_OPERASI', 'KONFLIK_VERSI',
    "p.sumber='mandiri' AND p.terbit_pada IS NULL", 'umkm_sahkan_pendaftar',
    "'dicabut','pemilik',u", 'INSERT INTO umkm_private.operasi_publik']) expect(sql).toContain(token);
  expect(mengandungKontrolTransaksi(sql)).toBe(false);
  expect(sql).not.toMatch(/CREATE POLICY|GRANT\s+(SELECT|ALL)\s+ON\s+(TABLE\s+)?public\.umkm_pemilik/i);
});
it('perbaikan G5: draf disembunyikan, sumber mandiri, perubahan, catatan dan detail tanpa pelaku', () => {
  const sql = readFileSync(new URL('./202611090010_umkm_pemilik.sql', import.meta.url), 'utf8');
  for (const token of ["p_aksi='draf' AND p.status='disembunyikan'", 'CREATE TRIGGER umkm_jaga_sumber_mandiri',
    "OLD.sumber='mandiri'", 'NEW.sumber_ref := OLD.sumber_ref', "'perubahan'", "THEN 'menunggu'",
    'akhir.aktor_uid=m.akun_uid', "h.referensi->>'revisi_id'=akhir.id::text",
    "to_jsonb(r)-'dibuat_oleh'-'aktor_uid'", "to_jsonb(f)-'diperiksa_oleh'"]) expect(sql).toContain(token);
});
