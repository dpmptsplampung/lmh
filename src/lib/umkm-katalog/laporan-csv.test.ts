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
