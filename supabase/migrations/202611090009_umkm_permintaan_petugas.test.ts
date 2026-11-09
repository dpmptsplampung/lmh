// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';
const sql = () => readFileSync(new URL('./202611090009_umkm_permintaan_petugas.sql', import.meta.url), 'utf8');
it('keputusan atomik, bantuan hash saja dan join riwayat tidak menghilangkan aktor perusahaan', () => {
  const text = sql();
  for (const token of ['FOR UPDATE', 'KONFLIK_VERSI', 'BELUM_TERTAUT', 'menunggu_izin',
    'INSERT INTO public.umkm_pembukaan_nomor', 'LEFT JOIN public.petugas', '730 days',
    'CREATE OR REPLACE FUNCTION public.umkm_jejak_pengawasan', 'tautan_hash']) expect(text).toContain(token);
  expect(text).not.toContain('CREATE TABLE');
  expect(mengandungKontrolTransaksi(text)).toBe(false);
});
it('detail bantuan, batas tahan dan retensi kebutuhan tertutup tetap menjadi kontrak', () => {
  const text = sql();
  expect(text).toContain("'bantuan',CASE WHEN r.sumber='petugas'");
  expect(text).toContain("IF r.status NOT IN ('diajukan','menunggu_izin','nomor_dibuka') THEN");
  expect(text).toContain("k.status='ditutup' AND k.teks<>''");
  expect(text).toContain("k.ditutup_pada<now()-interval '730 days'");
  expect(text).toContain("SET nama='Perusahaan dihapus',jabatan='Dihapus'");
});
