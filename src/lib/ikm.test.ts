// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ikmQuality, ikmQualityText, ikmQualityLabel, fmtIkm, summarizeIkm } from './ikm';

describe('ikmQuality', () => {
  it('maps scores to PermenPANRB 14/2017 grades', () => {
    expect(ikmQuality(100)).toBe('A');
    expect(ikmQuality(88)).toBe('A');
    expect(ikmQuality(87.99)).toBe('B');
    expect(ikmQuality(76)).toBe('B');
    expect(ikmQuality(75.99)).toBe('C');
    expect(ikmQuality(60)).toBe('C');
    expect(ikmQuality(59.99)).toBe('D');
    expect(ikmQuality(25)).toBe('D');
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
