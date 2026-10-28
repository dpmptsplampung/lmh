import { describe, expect, it } from 'vitest';
import { formatNilaiKhusus, susunJawabanMentah, validasiJawabanKhusus } from './jawaban';
import type { FieldKhusus } from './jenis';

const f = (o: Partial<FieldKhusus> & Pick<FieldKhusus, 'id' | 'jenis'>): FieldKhusus => ({
  layanan_id: 'l1', label: `Isian ${o.id}`, wajib: false, opsi: [], urut: 0, tersembunyi: false, pernah_diisi: false, ...o,
});

describe('validasiJawabanKhusus', () => {
  it('wajib berisi spasi atau kosong -> galat; opsional kosong dilewati', () => {
    const fields = [f({ id: 'a', jenis: 'teks_singkat', wajib: true }), f({ id: 'b', jenis: 'teks_panjang' })];
    const r = validasiJawabanKhusus(fields, { a: '   ', b: '' });
    expect(r.galat.a).toMatch(/wajib/i);
    expect(r.galat.b).toBeUndefined();
    expect(r.payload).toEqual({});
  });

  it('teks di-trim dan dibatasi 200 / 2000 karakter', () => {
    const fields = [f({ id: 'a', jenis: 'teks_singkat' }), f({ id: 'b', jenis: 'teks_panjang' })];
    expect(validasiJawabanKhusus(fields, { a: '  halo ', b: 'x'.repeat(2000) }).payload).toEqual({ a: 'halo', b: 'x'.repeat(2000) });
    const r = validasiJawabanKhusus(fields, { a: 'x'.repeat(201), b: 'x'.repeat(2001) });
    expect(r.galat.a).toBeDefined();
    expect(r.galat.b).toBeDefined();
  });

  it('angka: bilangan berhingga dalam batas; string angka ditolak; string kosong = tidak diisi', () => {
    const fields = [f({ id: 'n', jenis: 'angka', wajib: true })];
    expect(validasiJawabanKhusus(fields, { n: 12.5 }).payload).toEqual({ n: 12.5 });
    expect(validasiJawabanKhusus(fields, { n: 0 }).payload).toEqual({ n: 0 });
    expect(validasiJawabanKhusus(fields, { n: '12' }).galat.n).toBeDefined();
    expect(validasiJawabanKhusus(fields, { n: Number.NaN }).galat.n).toBeDefined();
    expect(validasiJawabanKhusus(fields, { n: 1e13 }).galat.n).toBeDefined();
    expect(validasiJawabanKhusus(fields, { n: '' }).galat.n).toMatch(/wajib/i);
  });

  it('tanggal: YYYY-MM-DD yang sah saja', () => {
    const fields = [f({ id: 't', jenis: 'tanggal' })];
    expect(validasiJawabanKhusus(fields, { t: '2026-10-30' }).payload).toEqual({ t: '2026-10-30' });
    expect(validasiJawabanKhusus(fields, { t: '2026-02-30' }).galat.t).toBeDefined();
    expect(validasiJawabanKhusus(fields, { t: '30/10/2026' }).galat.t).toBeDefined();
  });

  it('pilihan tunggal / ganda harus dari opsi; ganda tanpa duplikat; ganda kosong wajib = galat', () => {
    const fields = [
      f({ id: 's', jenis: 'pilihan_tunggal', opsi: ['A', 'B'] }),
      f({ id: 'g', jenis: 'pilihan_ganda', opsi: ['X', 'Y', 'Z'], wajib: true }),
    ];
    expect(validasiJawabanKhusus(fields, { s: 'A', g: ['X', 'Z'] }).payload).toEqual({ s: 'A', g: ['X', 'Z'] });
    expect(validasiJawabanKhusus(fields, { s: 'C', g: ['X'] }).galat.s).toBeDefined();
    expect(validasiJawabanKhusus(fields, { g: ['X', 'X'] }).galat.g).toBeDefined();
    expect(validasiJawabanKhusus(fields, { g: ['Q'] }).galat.g).toBeDefined();
    expect(validasiJawabanKhusus(fields, { g: [] }).galat.g).toMatch(/wajib/i);
  });

  it('ya/tidak: false dianggap terisi; selain boolean ditolak', () => {
    const fields = [f({ id: 'y', jenis: 'ya_tidak', wajib: true })];
    expect(validasiJawabanKhusus(fields, { y: false })).toEqual({ galat: {}, payload: { y: false } });
    expect(validasiJawabanKhusus(fields, { y: true }).payload).toEqual({ y: true });
    expect(validasiJawabanKhusus(fields, {}).galat.y).toMatch(/wajib/i);
    expect(validasiJawabanKhusus(fields, { y: 'ya' }).galat.y).toBeDefined();
  });

  it('isian tersembunyi tidak ditanyakan dan tidak dikirim', () => {
    const fields = [f({ id: 'h', jenis: 'teks_singkat', wajib: true, tersembunyi: true })];
    expect(validasiJawabanKhusus(fields, { h: 'x' })).toEqual({ galat: {}, payload: {} });
  });
});

describe('formatNilaiKhusus', () => {
  it('memformat per jenis untuk tabel/Excel', () => {
    expect(formatNilaiKhusus({ jenis: 'ya_tidak' }, true)).toBe('Ya');
    expect(formatNilaiKhusus({ jenis: 'ya_tidak' }, false)).toBe('Tidak');
    expect(formatNilaiKhusus({ jenis: 'pilihan_ganda' }, ['A', 'B'])).toBe('A; B');
    expect(formatNilaiKhusus({ jenis: 'angka' }, 7)).toBe(7);
    expect(formatNilaiKhusus({ jenis: 'tanggal' }, '2026-10-30')).toBe('30/10/2026');
    expect(formatNilaiKhusus({ jenis: 'teks_singkat' }, 'halo')).toBe('halo');
    expect(formatNilaiKhusus({ jenis: 'teks_singkat' }, undefined)).toBeNull();
  });
});

describe('susunJawabanMentah', () => {
  it('angka -> number (koma desimal diterima), ya/tidak -> boolean, kosong tidak disertakan', () => {
    const fields = [f({ id: 'n', jenis: 'angka' }), f({ id: 'y', jenis: 'ya_tidak' }), f({ id: 'z', jenis: 'ya_tidak' }), f({ id: 'k', jenis: 'angka' }), f({ id: 'g', jenis: 'pilihan_ganda', opsi: ['A'] })];
    expect(susunJawabanMentah(fields, { n: '12,5', y: 'ya', z: 'tidak', k: ' ', g: ['A'] })).toEqual({ n: 12.5, y: true, z: false, g: ['A'] });
  });
  it('angka tidak numerik menjadi NaN sehingga ditolak validasi', () => {
    const fields = [f({ id: 'n', jenis: 'angka' })];
    const r = validasiJawabanKhusus(fields, susunJawabanMentah(fields, { n: 'abc' }));
    expect(r.galat.n).toBeDefined();
  });
});
