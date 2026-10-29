import { describe, expect, it } from 'vitest';
import { hitungUkuran } from './kompres';

describe('hitungUkuran', () => {
  it('memperkecil sisi terpanjang ke batas dengan rasio tetap', () => {
    expect(hitungUkuran(4000, 3000)).toEqual({ lebar: 1280, tinggi: 960 });
    expect(hitungUkuran(3000, 4000)).toEqual({ lebar: 960, tinggi: 1280 });
  });
  it('tidak memperbesar gambar kecil', () => {
    expect(hitungUkuran(640, 480)).toEqual({ lebar: 640, tinggi: 480 });
  });
  it('ukuran tidak valid -> 0', () => {
    expect(hitungUkuran(0, 100)).toEqual({ lebar: 0, tinggi: 0 });
    expect(hitungUkuran(NaN, 100)).toEqual({ lebar: 0, tinggi: 0 });
  });
  it('sisi tipis tetap minimal 1 px', () => {
    expect(hitungUkuran(10000, 1).tinggi).toBe(1);
  });
});
