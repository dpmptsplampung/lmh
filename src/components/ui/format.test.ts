import { describe, expect, it } from 'vitest';
import { formatAngka, formatPersen, ucapkanPersen } from './format';

describe('format angka id-ID', () => {
  it('memakai titik ribuan dan koma desimal', () => {
    expect(formatAngka(14653)).toBe('14.653');
    expect(formatAngka(15.5)).toBe('15,5');
    expect(formatPersen(15.54)).toBe('15,5%');
    expect(ucapkanPersen(15.5)).toBe('15,5 persen');
  });
  it('nilai tidak hingga menjadi tanda hubung', () => {
    expect(formatAngka(Number.NaN)).toBe('-');
    expect(formatPersen(Infinity)).toBe('-');
  });
});
