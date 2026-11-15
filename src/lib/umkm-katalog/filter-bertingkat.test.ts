import { describe, expect, it } from 'vitest';
import { URUTAN_JENIS, gantiJenis, kategoriUntuk, labelJenis } from './filter-bertingkat';
import { KATEGORI_PER_JENIS } from './taksonomi';

describe('filter bertingkat', () => {
  it('urutan jenis dan label Produksi', () => {
    expect(URUTAN_JENIS).toEqual(['Bahan Baku', 'Produk', 'Jasa']);
    expect(labelJenis('Produk')).toBe('Produksi');
    expect(labelJenis('Jasa')).toBe('Jasa');
  });
  it('kategoriUntuk mengikuti urutan taksonomi dan hanya yang tersedia', () => {
    const [a, b, c] = KATEGORI_PER_JENIS.Jasa;
    expect(kategoriUntuk('Jasa', [c, 'Asing', a])).toEqual([a, c]);
    expect(b).toBeTruthy();
  });
  it('jenis kosong, tidak sah, atau tanpa irisan -> []', () => {
    expect(kategoriUntuk('', ['Kemasan'])).toEqual([]);
    expect(kategoriUntuk('toString', ['Kemasan'])).toEqual([]);
    expect(kategoriUntuk('Jasa', ['Kemasan'])).toEqual([]);
  });
  it('gantiJenis mengosongkan kategori dan spesifik', () => {
    const f = { jenis: 'Jasa', kategori: 'X', spesifik: 'y', kabupaten_kota: 'Z' };
    expect(gantiJenis(f, 'Produk')).toEqual({ jenis: 'Produk', kategori: '', spesifik: '', kabupaten_kota: 'Z' });
  });
});
