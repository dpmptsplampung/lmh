import { describe, expect, it } from 'vitest';
import { ikmGabungan, indeksSpak, jumlahPer, persen, rataSpakBaris, responseRateGabungan, spakGabungan, type SpakBaris } from './laporan';

const spak = (responden: number, p: Array<number | string | null>): SpakBaris => ({
  layanan_id: null, unit: 'layanan', nama: 'X', responden, p1: p[0], p2: p[1], p3: p[2], p4: p[3], p5: p[4],
});

describe('laporan Pesan Perilaku', () => {
  it('ikmGabungan dibobot responden, melewati unit tanpa nilai', () => {
    const r = ikmGabungan([
      { layanan_id: 'a', layanan_nama: 'A', ikm: 80, responden: 10 },
      { layanan_id: 'b', layanan_nama: 'B', ikm: 90, responden: 30 },
      { layanan_id: 'c', layanan_nama: 'C', ikm: null, responden: 5 },
    ]);
    expect(r.ikm).toBeCloseTo(87.5);
    expect(r.responden).toBe(40);
    expect(ikmGabungan([]).ikm).toBeNull();
  });
  it('SPAK: rata baris, gabungan dibobot, nilai string dari PostgREST diterima', () => {
    expect(rataSpakBaris(spak(1, [6, 6, 3, '3', 6]))).toBeCloseTo(4.8);
    const g = spakGabungan([spak(10, [6, 6, 6, 6, 6]), spak(30, ['4', '4', '4', '4', null])]);
    expect(g.p.p1).toBeCloseTo(4.5);
    expect(g.p.p5).toBe(6);
    expect(g.responden).toBe(40);
    expect(spakGabungan([]).rata).toBeNull();
  });
  it('indeksSpak skala 100 (6 = 100)', () => {
    expect(indeksSpak(6)).toBe(100);
    expect(indeksSpak(3)).toBe(50);
    expect(indeksSpak(null)).toBeNull();
  });
  it('persen dan response rate; pembagi 0 -> null', () => {
    expect(persen(1, 4)).toBe(25);
    expect(persen(1, 0)).toBeNull();
    expect(responseRateGabungan([{ layanan_id: null, unit: 'fo', nama: 'FO', diundang: 8, mengisi: 2 }, { layanan_id: 'a', unit: 'layanan', nama: 'A', diundang: 2, mengisi: 1 }]))
      .toEqual({ diundang: 10, mengisi: 3, persen: 30 });
  });
  it('jumlahPer mengelompokkan', () => {
    const baris = [
      { jalur: 'layanan', sumber: 'wizard', status: 'baru', jumlah: 2 },
      { jalur: 'layanan', sumber: 'web', status: 'baru', jumlah: 3 },
      { jalur: 'integritas', sumber: 'web', status: 'selesai', jumlah: 1 },
    ];
    expect(jumlahPer(baris, (r) => r.status)).toEqual({ baru: 5, selesai: 1 });
  });
});
