// @vitest-environment node
import { expect, it } from 'vitest';
import { laporanCsv } from './laporan-csv';
import type { LaporanStatistik } from './types';

const data: LaporanStatistik = {
  telemetri_opsional_aktif: false, versi_naskah: null, aktif_pada: null,
  profil: { diajukan: 0, terbit: 1, ditolak: 0, disembunyikan: 0 },
  suka: 0, dilihat: null, tanpa_hasil: null,
  pesan: { baru: 0, ditangani: 0 }, laporan: { baru: 0, ditangani: 0 },
  profil_statistik: [], kelompok_tanpa_hasil: [], next_cursor: null,
};
it('nama dan label bertitik koma menjadi koma yang dikutip agar rumus tidak membuka sel baru', () => {
  const csv = laporanCsv({ ...data,
    profil_statistik: [{ id: 'profil', nama: 'Toko A;=1+1', suka: 0, dilihat: null, klik_formulir: null }],
    kelompok_tanpa_hasil: [{ hari: '2026-11-09', kategori: ';=1+1', kabupaten_kota: 'Kota;@SUM(1)', jumlah: 1 }],
  });
  expect(csv).not.toContain(';');
  expect(csv).toContain('"Toko A,=1+1"');
  expect(csv).toContain('",=1+1"');
  expect(csv).toContain('"Kota,@SUM(1)"');
});

it('ringkasan memuat waktu aktif sakelar dalam WIB termasuk perpindahan tanggal UTC', () => {
  const csv = laporanCsv({ ...data, telemetri_opsional_aktif: true, aktif_pada: '2026-11-08T17:30:00Z' });
  expect(csv).toContain('Waktu aktif sakelar (WIB)');
  expect(csv).toContain('2026-11-09 00:30 WIB');
  expect(laporanCsv(data)).toContain('belum diaktifkan');
});

it('laporan tahap B memuat permintaan, durasi keputusan dan hasil tanpa kontak', () => {
  const csv = laporanCsv({ ...data,
    permintaan: { diajukan: 2, menunggu_izin: 1, nomor_dibuka: 3, ditolak: 0, dibatalkan: 0 },
    rata_keputusan_detik: 120, hasil: { belum_diketahui: 3, kerja_sama: 0, tidak_berlanjut: 0 },
    profil_statistik: [{ id: 'profil', nama: 'Kopi', suka: 0, dilihat: null, klik_formulir: null, permintaan: 6 }],
  });
  expect(csv).toContain('Permintaan per status');
  expect(csv).toContain('Lama tunggu keputusan (detik)');
  expect(csv).toContain('Hasil pembukaan');
  expect(csv).toContain('Minat perusahaan');
  expect(csv).not.toMatch(/[0-9]{8,}|kontak|pemohon|perusahaan_id/i);
});
