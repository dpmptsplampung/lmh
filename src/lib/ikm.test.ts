// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { AMBANG_IKM, KETERANGAN_AMBANG_IKM, RENTANG_MUTU_IKM, ikmQuality, ikmQualityText, ikmQualityLabel, fmtIkm, summarizeIkm } from './ikm';

describe('ikmQuality', () => {
  it('maps scores to PermenPANRB 14/2017 Lampiran Bab V A Tabel II (A 88,31 / B 76,61 / C 65,00)', () => {
    expect(ikmQuality(100)).toBe('A');
    expect(ikmQuality(88.31)).toBe('A');
    expect(ikmQuality(88)).toBe('B');
    expect(ikmQuality(88.3)).toBe('B');
    expect(ikmQuality(76.61)).toBe('B');
    expect(ikmQuality(76.6)).toBe('C');
    expect(ikmQuality(65)).toBe('C');
    expect(ikmQuality(64.99)).toBe('D');
    expect(ikmQuality(64)).toBe('D');
    expect(ikmQuality(25)).toBe('D');
  });

  it('satu konstanta ambang dengan rujukan peraturan; teks rentang diturunkan darinya', () => {
    expect(AMBANG_IKM).toMatchObject({ A: 88.31, B: 76.61, C: 65 });
    expect(AMBANG_IKM.rujukan).toMatch(/14 Tahun 2017/);
    expect(RENTANG_MUTU_IKM.map((m) => m.rentang)).toEqual(['88,31 - 100', '76,61 - 88,30', '65,00 - 76,60', 'di bawah 65,00']);
    expect(KETERANGAN_AMBANG_IKM).toBe('A ≥ 88,31; B ≥ 76,61; C ≥ 65,00; D di bawah 65,00');
  });

  it('returns null for missing or invalid scores', () => {
    expect(ikmQuality(null)).toBeNull();
    expect(ikmQuality(NaN)).toBeNull();
  });
});

describe('ikmQualityText / ikmQualityLabel', () => {
  it('provides Indonesian labels', () => {
    expect(ikmQualityText(90)).toBe('Sangat Baik');
    expect(ikmQualityText(80)).toBe('Baik');
    expect(ikmQualityText(70)).toBe('Kurang Baik');
    expect(ikmQualityText(62)).toBe('Tidak Baik');
    expect(ikmQualityText(40)).toBe('Tidak Baik');
    expect(ikmQualityText(null)).toBe('N/A');
    expect(ikmQualityLabel(90)).toBe('A — Sangat Baik');
    expect(ikmQualityLabel(null)).toBe('N/A');
  });
});

describe('fmtIkm', () => {
  it('formats with one decimal and em-dash fallback', () => {
    expect(fmtIkm(90.28)).toBe('90.3');
    expect(fmtIkm(65)).toBe('65.0');
    expect(fmtIkm(null)).toBe('—');
    expect(fmtIkm(NaN)).toBe('—');
  });
});

describe('summarizeIkm', () => {
  it('aggregates totals and averages only scored rows', () => {
    const summary = summarizeIkm([
      { layanan_id: 'a', layanan_nama: 'A', ikm: 90, responden: 10 },
      { layanan_id: 'b', layanan_nama: 'B', ikm: null, responden: 5 },
      { layanan_id: 'c', layanan_nama: 'C', ikm: 60, responden: 3 },
    ]);
    expect(summary.totalResponden).toBe(18);
    expect(summary.scoredCount).toBe(2);
    expect(summary.avgIkm).toBe(75);
  });

  it('returns null average when nothing is scored', () => {
    expect(summarizeIkm([]).avgIkm).toBeNull();
    expect(summarizeIkm([{ layanan_id: 'a', layanan_nama: 'A', ikm: null, responden: 0 }]).avgIkm).toBeNull();
  });
});
