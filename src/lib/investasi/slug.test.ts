import { expect, it } from 'vitest';
import { buatSlug, normalisasiSlug } from './slug';
it('menormalkan judul dan memberi akhiran bentrok tanpa melanggar SQL', () => {
  expect(buatSlug('  Énergi & Wisata Lampung  ')).toBe('energi-wisata-lampung');
  expect(buatSlug('Energi Lampung', 2)).toBe('energi-lampung-2');
  expect(buatSlug('!!!')).toBe('ipro');
  expect(buatSlug('a')).toBe('ipro-a');
  expect(normalisasiSlug('a'.repeat(105))).toHaveLength(100);
  expect(buatSlug('ab-'.repeat(40))).not.toMatch(/-$/);
});
