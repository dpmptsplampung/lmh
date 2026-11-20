import { expect, it } from 'vitest';
import { formatNilaiRingkas, formatPayback, formatPersen, formatRupiahRingkas } from './format';
it('menampilkan mata uang tersimpan tanpa konversi', () => {
  expect(formatRupiahRingkas(1_200_000_000_000)).toBe('Rp 1,2 T');
  expect(formatNilaiRingkas(1_200_000, 'USD')).toBe('USD 1,2 jt');
  expect(formatNilaiRingkas(-3_000_000_000, 'USD')).toBe('USD -3 M');
  expect(formatRupiahRingkas(0)).toBe('Rp 0');
  expect(formatRupiahRingkas(null)).toBe('—');
  expect(formatPersen(12.5)).toBe('12,5%');
  expect(formatPersen(null)).toBe('—');
  expect(formatPayback(26)).toBe('2 tahun 2 bulan');
  expect(formatPayback(24)).toBe('2 tahun');
  expect(formatPayback(6)).toBe('6 bulan');
  expect(formatPayback(null)).toBe('—');
});
