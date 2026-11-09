// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';
const sql = () => readFileSync(new URL('./202611090008_umkm_permintaan.sql', import.meta.url), 'utf8');
it('empat tabel privat, UID dapat dikosongkan, tanpa tabel keputusan tambahan', () => {
  const text = sql();
  for (const table of ['umkm_perusahaan', 'umkm_kebutuhan', 'umkm_permintaan_kontak', 'umkm_pembukaan_nomor']) {
    expect(text).toContain(`CREATE TABLE public.${table}`);
    expect(text).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
  }
  expect(text).toContain('ON DELETE SET NULL');
  expect(text).not.toMatch(/CREATE TABLE public\.umkm_(keputusan|rekonsiliasi)/);
  expect(text).toContain('FROM PUBLIC,anon,authenticated,service_role');
  expect(mengandungKontrolTransaksi(text)).toBe(false);
});
it('penghapusan akun menutup kebutuhan dan tanggal retensi tersedia', () => {
  const text = sql();
  expect(text).toContain('ditutup_pada timestamptz');
  expect(text).toContain('CREATE TRIGGER umkm_perusahaan_akun_terhapus');
  expect(text).toContain('OLD.pemohon_uid IS NOT NULL AND NEW.pemohon_uid IS NULL');
  expect(text).toContain('r.pemohon_uid=OLD.pemohon_uid');
});
