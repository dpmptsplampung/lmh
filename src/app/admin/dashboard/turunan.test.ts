import { describe, expect, it } from 'vitest';
import { hariTersibuk, irisanDonat, jumlahKunjungan, rataMenit, ringkasPerLayanan, susunHarian } from './turunan';

describe('susunHarian', () => {
  it('memberi hari dan label dari kalender WIB, hitungan hilang = 0', () => {
    const h = susunHarian(['2026-11-02', '2026-11-03'], { '2026-11-03': 4 });
    expect(h[0]).toMatchObject({ hari: 'Sen', label: 'Sen 2', tanggalPendek: '2 Nov', kunjungan: 0 });
    expect(h[1]).toMatchObject({ hari: 'Sel', label: 'Sel 3', kunjungan: 4 });
  });
});

describe('hariTersibuk / jumlahKunjungan', () => {
  it('semua nol: tidak ada hari tersibuk', () => {
    const h = susunHarian(['2026-11-02', '2026-11-03'], {});
    expect(hariTersibuk(h)).toBeNull();
    expect(jumlahKunjungan(h)).toBe(0);
  });
  it('seri: hari terbaru menang', () => {
    const h = susunHarian(['2026-11-02', '2026-11-03', '2026-11-04'], { '2026-11-02': 5, '2026-11-03': 5, '2026-11-04': 1 });
    expect(hariTersibuk(h)?.tanggal).toBe('2026-11-03');
    expect(jumlahKunjungan(h)).toBe(11);
  });
});

describe('rataMenit', () => {
  it('rata-rata dari pasangan lengkap saja', () => {
    const r = rataMenit([
      ['2026-11-04T01:00:00Z', '2026-11-04T01:10:00Z'],
      ['2026-11-04T02:00:00Z', '2026-11-04T02:20:00Z'],
      [null, '2026-11-04T03:00:00Z'],
    ]);
    expect(r).toEqual({ rata: 15, jumlah: 2 });
  });
  it('tanpa pasangan lengkap: null (bukan 0)', () => {
    expect(rataMenit([[null, null]])).toEqual({ rata: null, jumlah: 0 });
    expect(rataMenit([])).toEqual({ rata: null, jumlah: 0 });
  });
});

describe('ringkasPerLayanan / irisanDonat', () => {
  const tiket = [
    { nama: 'A', status: 'menunggu' }, { nama: 'A', status: 'selesai' }, { nama: 'B', status: 'dilayani' },
    { nama: null, status: 'selesai' }, { nama: 'C', status: 'selesai' },
  ];
  it('hitung per status dan urut terbanyak; tanpa nama dilewati', () => {
    const r = ringkasPerLayanan(tiket);
    expect(r.map((x) => x.nama)).toEqual(['A', 'B', 'C']);
    expect(r[0]).toEqual({ nama: 'A', menunggu: 1, dilayani: 0, selesai: 1, total: 2 });
  });
  it('donat: sisa di luar batas jadi Lainnya, total tetap', () => {
    const r = ringkasPerLayanan(tiket);
    const d = irisanDonat(r, 2);
    expect(d).toEqual([{ nama: 'A', nilai: 2 }, { nama: 'B', nilai: 1 }, { nama: 'Lainnya', nilai: 1 }]);
    expect(irisanDonat(r, 5)).toHaveLength(3);
  });
});
