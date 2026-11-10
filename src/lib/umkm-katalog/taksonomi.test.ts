import { describe, expect, it } from 'vitest';
import {
  JENIS_USAHA, KATEGORI_PER_JENIS, formatKapasitas, kategoriSah,
} from './taksonomi';
import { KABUPATEN_KOTA, WILAYAH_LAMPUNG, kecamatanDari } from './wilayah';

describe('taksonomi UMKM', () => {
  it('31 kategori terbagi 11/10/10', () => {
    expect(JENIS_USAHA.map(j => KATEGORI_PER_JENIS[j].length)).toEqual([11, 10, 10]);
    const semua = JENIS_USAHA.flatMap(j => KATEGORI_PER_JENIS[j]);
    expect(semua).toHaveLength(31);
    expect(new Set(semua).size).toBe(31);
  });

  it('kategoriSah menolak kategori dari jenis lain', () => {
    expect(kategoriSah('Produk', 'Makanan Olahan')).toBe(true);
    expect(kategoriSah('Jasa', 'Makanan Olahan')).toBe(false);
    expect(kategoriSah('Produk', 'Pangan')).toBe(false);
  });

  it('wilayah 15 kab/kota dan 229 kecamatan', () => {
    expect(KABUPATEN_KOTA).toHaveLength(15);
    const total = KABUPATEN_KOTA.reduce((n, k) => n + WILAYAH_LAMPUNG[k].length, 0);
    expect(total).toBe(229);
    expect(kecamatanDari('Kota Metro').length).toBeGreaterThan(0);
    expect(kecamatanDari('Lampung')).toEqual([]);
  });

  it('formatKapasitas', () => {
    expect(formatKapasitas({ kapasitas_jumlah: 1500, kapasitas_satuan: 'kg', kapasitas_periode: 'bulan' }))
      .toBe('Kapasitas 1.500 kg per bulan (menurut UMKM)');
  });
});
