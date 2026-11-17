import { describe, expect, it } from 'vitest';
import { susunDraf, susunJawabanFinal, teksNilai } from './susunKhusus';

describe('teksNilai', () => {
  it('memformat per jenis dan null untuk kosong', () => {
    expect(teksNilai('ya_tidak', true)).toBe('Ya');
    expect(teksNilai('ya_tidak', false)).toBe('Tidak');
    expect(teksNilai('pilihan_ganda', ['A', 'B'])).toBe('A; B');
    expect(teksNilai('angka', 12)).toBe('12');
    expect(teksNilai('teks_singkat', null)).toBeNull();
    expect(teksNilai('teks_singkat', '  ')).toBeNull();
  });
});

describe('susunJawabanFinal', () => {
  it('mengelompokkan per penanganan tanpa menggabungkan tahap yang field_id-nya sama', () => {
    const t = susunJawabanFinal([
      { penanganan_id: 'p1', field_id: 'f1', label: 'Nomor', jenis: 'teks_singkat', nilai: 'A', tersembunyi: false, urut: 0 },
      { penanganan_id: 'p2', field_id: 'f1', label: 'Nomor', jenis: 'teks_singkat', nilai: 'B', tersembunyi: false, urut: 0 },
    ]);
    expect(t).toHaveLength(2);
    expect(t.map((x) => x.baris[0].teks)).toEqual(['A', 'B']);
  });
});

describe('susunDraf', () => {
  const def = [
    { id: 'f2', label: 'Kedua', jenis: 'ya_tidak', tersembunyi: false, urut: 1 },
    { id: 'f1', label: 'Pertama', jenis: 'teks_singkat', tersembunyi: false, urut: 0 },
    { id: 'fs', label: 'Lama', jenis: 'teks_singkat', tersembunyi: true, urut: 0 },
    { id: 'fk', label: 'Kosong tersembunyi', jenis: 'teks_singkat', tersembunyi: true, urut: 1 },
  ];
  it('urut terlihat dahulu; belum diisi = null; tersembunyi hanya bila berjawaban; label dari definisi terbaru', () => {
    const baris = susunDraf({ jawaban: { f1: 'X', fs: 'warisan' }, updated_at: '2026-11-17T01:00:00Z' }, def);
    expect(baris.map((b) => [b.label, b.teks, b.tersembunyi])).toEqual([
      ['Pertama', 'X', false], ['Kedua', null, false], ['Lama', 'warisan', true],
    ]);
  });
});
