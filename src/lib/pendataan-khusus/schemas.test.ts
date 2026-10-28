import { describe, expect, it } from 'vitest';
import { fieldBaruSchema, fieldUbahSchema, urutanSchema } from './schemas';

describe('fieldBaruSchema', () => {
  it('menerima isian teks tanpa opsi; wajib=false dan opsi=[] default', () => {
    const r = fieldBaruSchema.parse({ label: ' Nomor surat ', jenis: 'teks_singkat' });
    expect(r).toEqual({ label: 'Nomor surat', jenis: 'teks_singkat', wajib: false, opsi: [] });
  });
  it('pilihan wajib 2-20 butir unik (tanpa beda huruf besar kecil), maksimal 100 karakter', () => {
    expect(fieldBaruSchema.safeParse({ label: 'Jenis', jenis: 'pilihan_tunggal', opsi: ['A'] }).success).toBe(false);
    expect(fieldBaruSchema.safeParse({ label: 'Jenis', jenis: 'pilihan_ganda', opsi: ['A', 'a'] }).success).toBe(false);
    expect(fieldBaruSchema.safeParse({ label: 'Jenis', jenis: 'pilihan_ganda', opsi: Array.from({ length: 21 }, (_, i) => `o${i}`) }).success).toBe(false);
    expect(fieldBaruSchema.safeParse({ label: 'Jenis', jenis: 'pilihan_tunggal', opsi: ['A', 'x'.repeat(101)] }).success).toBe(false);
    expect(fieldBaruSchema.parse({ label: 'Jenis', jenis: 'pilihan_tunggal', opsi: [' A ', 'B'] }).opsi).toEqual(['A', 'B']);
  });
  it('jenis di luar tujuh jenis dan opsi pada jenis non-pilihan ditolak; tidak ada jenis berkas', () => {
    expect(fieldBaruSchema.safeParse({ label: 'Berkas', jenis: 'berkas' }).success).toBe(false);
    expect(fieldBaruSchema.safeParse({ label: 'Angka', jenis: 'angka', opsi: ['1', '2'] }).success).toBe(false);
  });
  it('label 2-100 karakter', () => {
    expect(fieldBaruSchema.safeParse({ label: 'A', jenis: 'angka' }).success).toBe(false);
    expect(fieldBaruSchema.safeParse({ label: 'x'.repeat(101), jenis: 'angka' }).success).toBe(false);
  });
});

describe('fieldUbahSchema', () => {
  it('jenis dan kunci asing tidak boleh diubah lewat PATCH', () => {
    expect(fieldUbahSchema.safeParse({ jenis: 'angka' }).success).toBe(false);
    expect(fieldUbahSchema.safeParse({ layanan_id: '8d9c7a2e-0000-4000-8000-000000000000' }).success).toBe(false);
    expect(fieldUbahSchema.safeParse({ pernah_diisi: false }).success).toBe(false);
  });
  it('menerima label, wajib, opsi, tersembunyi sebagian; kosong ditolak', () => {
    expect(fieldUbahSchema.parse({ label: 'Baru', tersembunyi: true })).toEqual({ label: 'Baru', tersembunyi: true });
    expect(fieldUbahSchema.safeParse({}).success).toBe(false);
  });
});

describe('urutanSchema', () => {
  it('daftar uuid unik', () => {
    const a = '8d9c7a2e-0000-4000-8000-000000000001';
    expect(urutanSchema.parse({ urutan: [a] }).urutan).toEqual([a]);
    expect(urutanSchema.safeParse({ urutan: [a, a] }).success).toBe(false);
    expect(urutanSchema.safeParse({ urutan: ['x'] }).success).toBe(false);
  });
});
