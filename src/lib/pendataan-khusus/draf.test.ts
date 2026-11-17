import { describe, it, expect } from 'vitest';
import { drafDariForm, formDariDraf, jumlahWajibKosong, kunciDraf } from './draf';
import type { FieldKhusus } from './jenis';

const f = (id: string, jenis: FieldKhusus['jenis'], o: Partial<FieldKhusus> = {}): FieldKhusus => ({
  id, layanan_id: 'ly', label: id, jenis, wajib: false, opsi: [], urut: 0, tersembunyi: false, pernah_diisi: false, ...o,
});
const FIELDS = [
  f('teks', 'teks_singkat'),
  f('panjang', 'teks_panjang'),
  f('angka', 'angka'),
  f('tgl', 'tanggal'),
  f('pil', 'pilihan_tunggal', { opsi: ['A', 'B'] }),
  f('ganda', 'pilihan_ganda', { opsi: ['X', 'Y', 'Z'] }),
  f('yt', 'ya_tidak'),
];

describe('drafDariForm', () => {
  it('mengubah isian formulir menjadi nilai bertipe JSON per UUID isian', () => {
    expect(drafDariForm(FIELDS, {
      teks: ' halo ', panjang: 'uraian', angka: '12,5', tgl: '2026-11-17', pil: 'B', ganda: ['X', 'Z', 'X'], yt: 'tidak',
    })).toEqual({ teks: 'halo', panjang: 'uraian', angka: 12.5, tgl: '2026-11-17', pil: 'B', ganda: ['X', 'Z'], yt: false });
  });

  it('false dan 0 adalah jawaban sah; "ya" menjadi true', () => {
    expect(drafDariForm(FIELDS, { angka: '0', yt: 'ya' })).toEqual({ angka: 0, yt: true });
    expect(drafDariForm(FIELDS, { yt: 'tidak' })).toEqual({ yt: false });
  });

  it('nilai kosong atau tak terbaca dibuang; draf boleh belum lengkap', () => {
    expect(drafDariForm(FIELDS, {
      teks: '   ', angka: 'abc', tgl: '17/11/2026', pil: 'C', ganda: ['Q'], yt: '',
    })).toEqual({});
    expect(drafDariForm(FIELDS, {})).toEqual({});
  });

  it('isian tersembunyi dan kunci asing tidak ikut', () => {
    const fields = [f('a', 'teks_singkat', { tersembunyi: true }), f('b', 'teks_singkat')];
    expect(drafDariForm(fields, { a: 'x', b: 'y', asing: 'z' })).toEqual({ b: 'y' });
  });
});

describe('formDariDraf', () => {
  it('draf -> isian formulir (angka dan ya/tidak kembali menjadi teks)', () => {
    expect(formDariDraf(FIELDS, { teks: 'halo', angka: 0, yt: false, ganda: ['X'], pil: 'A' }))
      .toEqual({ teks: 'halo', angka: '0', yt: 'tidak', ganda: ['X'], pil: 'A' });
  });

  it('kunci asing (isian sudah disembunyikan/dihapus) dan tipe salah dilewati; null/undefined aman', () => {
    expect(formDariDraf(FIELDS, { hantu: 'x', angka: { a: 1 }, ganda: 'bukan array' })).toEqual({ ganda: [] });
    expect(formDariDraf(FIELDS, null)).toEqual({});
    expect(formDariDraf(FIELDS, undefined)).toEqual({});
    expect(formDariDraf([f('a', 'teks_singkat', { tersembunyi: true })], { a: 'x' })).toEqual({});
  });

  it('bolak-balik form -> draf -> form stabil', () => {
    const form = { teks: 'halo', angka: '7', yt: 'ya', ganda: ['Y'] };
    expect(formDariDraf(FIELDS, drafDariForm(FIELDS, form))).toEqual(form);
  });
});

describe('kunciDraf dan jumlahWajibKosong', () => {
  it('kunci tak bergantung urutan kunci', () => {
    expect(kunciDraf({ a: 1, b: 'x' })).toBe(kunciDraf({ b: 'x', a: 1 }));
    expect(kunciDraf({ a: 1 })).not.toBe(kunciDraf({ a: 2 }));
  });

  it('menghitung isian wajib terlihat yang belum terjawab (false/0 terhitung terjawab)', () => {
    const fields = [f('a', 'teks_singkat', { wajib: true }), f('b', 'ya_tidak', { wajib: true }),
      f('c', 'angka', { wajib: true }), f('d', 'teks_singkat', { wajib: true, tersembunyi: true }), f('e', 'teks_singkat')];
    expect(jumlahWajibKosong(fields, {})).toBe(3);
    expect(jumlahWajibKosong(fields, { b: false, c: 0 })).toBe(1);
  });
});
