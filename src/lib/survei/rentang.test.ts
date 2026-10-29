import { describe, expect, it } from 'vitest';
import { kenaliPreset, labelRentang, rentangPreset } from './rentang';

describe('rentangPreset', () => {
  it.each([
    ['tujuh', '2026-11-03', '2026-10-28', '2026-11-03'],
    ['tigapuluh', '2026-11-03', '2026-10-05', '2026-11-03'],
    ['bulan', '2026-11-03', '2026-11-01', '2026-11-03'],
    ['kuartal', '2026-11-03', '2026-10-01', '2026-11-03'],
    ['kuartal', '2026-03-31', '2026-01-01', '2026-03-31'],
    ['kuartal', '2026-04-01', '2026-04-01', '2026-04-01'],
    ['tahun', '2026-11-03', '2026-01-01', '2026-11-03'],
    ['tujuh', '2026-01-03', '2025-12-28', '2026-01-03'], // lintas tahun
  ] as const)('%s pada %s', (preset, hariIni, dari, sampai) => {
    expect(rentangPreset(preset, hariIni)).toEqual({ dari, sampai });
  });
});

describe('kenaliPreset', () => {
  it('mengenali preset persis dan selain itu kustom', () => {
    expect(kenaliPreset('2026-11-01', '2026-11-03', '2026-11-03')).toBe('bulan');
    expect(kenaliPreset('2026-11-02', '2026-11-03', '2026-11-03')).toBe('kustom');
  });
});

describe('labelRentang', () => {
  it('format dd/mm/yyyy', () => {
    expect(labelRentang('2026-11-01', '2026-11-03')).toBe('01/11/2026 s.d. 03/11/2026');
    expect(labelRentang('2026-11-03', '2026-11-03')).toBe('03/11/2026');
  });
});
