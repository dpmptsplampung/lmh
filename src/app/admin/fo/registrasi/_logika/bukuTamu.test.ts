import { describe, expect, it } from 'vitest';
import type { TamuBuku } from '@/lib/data/buku-tamu';
import {
  galatRentang, hpTampil, jumlahHari, perluResetKeHariIni, petugasPilihan, pesanTerpotong, ringkasanDaftar, teksKeluar,
} from './bukuTamu';

const tamu = (o: Partial<TamuBuku> = {}): TamuBuku => ({
  id: 't', nama: 'A', instansi: null, no_hp: null, bertemu: 'X', tujuan: null,
  waktu_masuk: '2026-10-08T02:30:00Z', waktu_keluar: null, menemui_petugas_id: null, dicatat_oleh: null, dicatat_nama: null, ...o,
});

describe('rentang', () => {
  it('jumlahHari menghitung kedua ujung, tahan lintas tahun kabisat', () => {
    expect(jumlahHari('2026-10-08', '2026-10-08')).toBe(1);
    expect(jumlahHari('2026-10-01', '2026-10-31')).toBe(31);
    expect(jumlahHari('2024-01-01', '2024-12-31')).toBe(366);
  });

  it('galatRentang: kosong, terbalik, terlalu panjang; valid = undefined', () => {
    expect(galatRentang('', '2026-10-08')).toMatch(/Pilih tanggal/);
    expect(galatRentang('2026-10-09', '2026-10-08')).toMatch(/tidak boleh sebelum/);
    expect(galatRentang('2025-01-01', '2026-10-08')).toMatch(/366 hari/);
    expect(galatRentang('2026-01-01', '2026-10-08')).toBeUndefined();
    expect(galatRentang('2026-10-08', '2026-10-08')).toBeUndefined();
  });
});

describe('tampilan', () => {
  it('hpTampil: E.164 -> 0812-3456-7890; kosong -> tanda strip', () => {
    expect(hpTampil('+6281234567890')).toBe('0812-3456-7890');
    expect(hpTampil(null)).toBe('—');
  });

  it('teksKeluar: null bila belum keluar; jam WIB bila hari sama; tanggal ikut bila beda hari', () => {
    expect(teksKeluar(tamu())).toBeNull();
    expect(teksKeluar(tamu({ waktu_keluar: '2026-10-08T05:15:00Z' }))).toMatch(/^12[.:]15 WIB$/);
    expect(teksKeluar(tamu({ waktu_keluar: '2026-10-09T05:15:00Z' }))).toMatch(/9 Okt 2026, 12[.:]15 WIB/);
  });

  it('ringkasanDaftar menyebut periode dan kata kunci', () => {
    expect(ringkasanDaftar(3, { dari: '2026-10-08', sampai: '2026-10-08', q: '' })).toBe('3 tamu pada 8 Oktober 2026');
    expect(ringkasanDaftar(1, { dari: '2026-10-01', sampai: '2026-10-08', q: 'Dinas' })).toBe(
      '1 tamu pada 1 Oktober 2026 sampai 8 Oktober 2026 dengan kata kunci "Dinas"',
    );
  });

  it('pesanTerpotong menyebut batas baris', () => {
    expect(pesanTerpotong()).toMatch(/50\.000 baris/);
  });
});

describe('petugasPilihan', () => {
  it('hanya petugas aktif, nama dirapikan, urut abjad; null -> kosong', () => {
    const p = (id: string, nama: string, aktif: boolean) => ({ id, nama, role: 'petugas' as const, layanan_id: null, aktif });
    expect(petugasPilihan([p('1', 'Budi', true), p('2', 'Agus', false), p('3', ' Ani ', true), p('4', '  ', true)])).toEqual([
      { id: '3', nama: 'Ani' }, { id: '1', nama: 'Budi' },
    ]);
    expect(petugasPilihan(null)).toEqual([]);
  });
});

describe('perluResetKeHariIni', () => {
  const f = (dari: string, sampai: string, q = '') => ({ dari, sampai, q });
  it('tamu baru tidak terlihat bila hari ini di luar rentang atau ada pencarian', () => {
    expect(perluResetKeHariIni(f('2026-10-08', '2026-10-08'), '2026-10-08')).toBe(false);
    expect(perluResetKeHariIni(f('2026-10-01', '2026-10-31'), '2026-10-08')).toBe(false);
    expect(perluResetKeHariIni(f('2026-10-01', '2026-10-07'), '2026-10-08')).toBe(true);
    expect(perluResetKeHariIni(f('2026-10-09', '2026-10-10'), '2026-10-08')).toBe(true);
    expect(perluResetKeHariIni(f('2026-10-08', '2026-10-08', 'x'), '2026-10-08')).toBe(true);
  });
});
