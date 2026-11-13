// Penyaringan, paginasi, dan cakupan awal dialog Kelola FAQ (tugas 8.1).
import { describe, expect, it } from 'vitest';
import { UMUM_KEY, type FAQ } from '@/components/admin/faq/types';
import { UKURAN_HALAMAN, adaFilterAktif, kunciAwalTambah, potongHalaman, saringFaq } from './saringFaq';

const f = (id: string, o: Partial<FAQ> = {}): FAQ => ({ id, layanan_id: 'l1', pertanyaan: `Tanya ${id}`, jawaban: `Jawab ${id}`, aktif: true, urutan: 1, ...o });
const SEMUA = [
  f('a', { pertanyaan: 'Syarat NIB?', jawaban: 'KTP dan NPWP.' }),
  f('b', { layanan_id: null, pertanyaan: 'Jam buka kantor?', aktif: false }),
  f('c', { layanan_id: 'l2', pertanyaan: 'Biaya izin?', jawaban: 'Gratis untuk UMK.' }),
];
const kosong = { cari: '', status: 'semua' as const, cakupan: '' };

describe('saringFaq', () => {
  it('tanpa filter mengembalikan semua', () => {
    expect(saringFaq(SEMUA, kosong).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
  it('status aktif / nonaktif', () => {
    expect(saringFaq(SEMUA, { ...kosong, status: 'aktif' }).map((x) => x.id)).toEqual(['a', 'c']);
    expect(saringFaq(SEMUA, { ...kosong, status: 'nonaktif' }).map((x) => x.id)).toEqual(['b']);
  });
  it('cakupan umum hanya layanan_id null; cakupan layanan hanya id itu', () => {
    expect(saringFaq(SEMUA, { ...kosong, cakupan: UMUM_KEY }).map((x) => x.id)).toEqual(['b']);
    expect(saringFaq(SEMUA, { ...kosong, cakupan: 'l2' }).map((x) => x.id)).toEqual(['c']);
  });
  it('pencarian tak peka huruf besar, mencakup pertanyaan dan jawaban, pangkas spasi', () => {
    expect(saringFaq(SEMUA, { ...kosong, cari: '  npwp ' }).map((x) => x.id)).toEqual(['a']);
    expect(saringFaq(SEMUA, { ...kosong, cari: 'BIAYA' }).map((x) => x.id)).toEqual(['c']);
  });
  it('filter digabung (AND)', () => {
    expect(saringFaq(SEMUA, { cari: 'izin', status: 'nonaktif', cakupan: '' })).toEqual([]);
  });
});

describe('adaFilterAktif', () => {
  it('false bila semua bawaan (spasi saja tidak dihitung), true bila salah satu terisi', () => {
    expect(adaFilterAktif(kosong)).toBe(false);
    expect(adaFilterAktif({ ...kosong, cari: '   ' })).toBe(false);
    expect(adaFilterAktif({ ...kosong, cari: 'x' })).toBe(true);
    expect(adaFilterAktif({ ...kosong, status: 'aktif' })).toBe(true);
    expect(adaFilterAktif({ ...kosong, cakupan: 'l1' })).toBe(true);
  });
});

describe('potongHalaman', () => {
  const dua = Array.from({ length: UKURAN_HALAMAN + 5 }, (_, i) => i);
  it('memotong per UKURAN_HALAMAN', () => {
    expect(potongHalaman(dua, 0)).toEqual({ halaman: 0, isi: dua.slice(0, UKURAN_HALAMAN) });
    expect(potongHalaman(dua, 1)).toEqual({ halaman: 1, isi: dua.slice(UKURAN_HALAMAN) });
  });
  it('halaman di luar jangkauan dijepit; daftar kosong = halaman 0', () => {
    expect(potongHalaman(dua, 9).halaman).toBe(1);
    expect(potongHalaman([], 3)).toEqual({ halaman: 0, isi: [] });
  });
});

describe('kunciAwalTambah', () => {
  const opsi = [{ id: null, nama: 'Umum' }, { id: 'l1', nama: 'A' }];
  it('memakai filter cakupan bila boleh dikelola; selain itu opsi pertama; kosong bila tak ada opsi', () => {
    expect(kunciAwalTambah('l1', opsi)).toBe('l1');
    expect(kunciAwalTambah(UMUM_KEY, opsi)).toBe(UMUM_KEY);
    expect(kunciAwalTambah('l9', opsi)).toBe(UMUM_KEY);
    expect(kunciAwalTambah('', [{ id: 'l1', nama: 'A' }])).toBe('l1');
    expect(kunciAwalTambah('l1', [])).toBe('');
  });
});
