import { expect, it } from 'vitest';
import { templatKodeTautan, templatPemberitahuanPemohon } from './templat-whatsapp';

const tautanMasuk = 'https://lmh.lampungprov.go.id/me/umkm';
it('pemberitahuan hanya berisi kode, tautan akun dan peringatan', () => {
  const hasil = templatPemberitahuanPemohon({ namaPemohon: 'Rina', namaPetugas: 'Sari',
    kodePermintaan: 'UM-ABCD', namaUmkm: 'Kopi Lampung', tautanMasuk });
  expect(hasil).toBe('Halo Rina, saya Sari, petugas UMKM DPMPTSP. Permintaan UM-ABCD untuk Kopi Lampung ' +
    'disetujui. Silakan masuk ke akun LMH untuk melihat nomornya: ' + tautanMasuk +
    '. DPMPTSP tidak menjamin transaksi; jangan mengirim uang sebelum ada kesepakatan tertulis.');
  expect(hasil).not.toMatch(/wa\.me|[0-9]{8,}/);
});
it('bantuan menjelaskan langkah masuk dan kode tanpa parameter nomor UMKM', () => {
  const hasil = templatKodeTautan({ namaPemohon: 'Rina', namaPetugas: 'Sari',
    kodeTautan: 'ABCD-EFGH-JKMN', tautanMasuk });
  expect(hasil).toContain('ABCD-EFGH-JKMN');
  expect(hasil).toContain('masuk, isi data perusahaan, masukkan kode');
  expect(hasil).toContain('jangan mengirim uang sebelum ada kesepakatan tertulis');
  expect(hasil).not.toMatch(/wa\.me|[0-9]{8,}/);
});
