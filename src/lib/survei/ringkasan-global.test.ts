import { describe, expect, it } from 'vitest';
import { hitungIkmGlobal, hitungSpakGlobal, kelompokPeriode, persen, type BarisMentah } from './ringkasan-global';

const PERIODE = { dari: '2026-11-01', sampai: '2026-11-30' };

function spak(waktu: string, p: [number, number, number, number, number]): BarisMentah {
  return {
    created_at: waktu,
    p1_tanpa_diskriminasi: p[0], p2_tanpa_kecurangan: p[1], p3_tanpa_imbalan: p[2], p4_tanpa_pungli: p[3], p5_tanpa_percaloan: p[4],
    // Layanan sengaja ada di baris: hasil global tidak boleh terpengaruh olehnya.
    layanan_id: waktu,
  };
}
function skm(waktu: string, nilai: number | null[] | number, u10: number | null = null, u11: number | null = null): BarisMentah {
  const n = (i: number) => (typeof nilai === 'number' ? nilai : (nilai as (number | null)[])[i]);
  return {
    created_at: waktu,
    u1_persyaratan: n(0), u2_prosedur: n(1), u3_waktu: n(2), u4_biaya: n(3), u5_produk: n(4), u6_kompetensi: n(5),
    u7_perilaku: n(6), u8_sarana: n(7), u9_pengaduan: n(8), u10_transparansi: u10, u11_integritas: u11,
  };
}

describe('persen', () => {
  it('null bila penyebut 0', () => {
    expect(persen(1, 0)).toBeNull();
    expect(persen(1, 4)).toBe(25);
  });
});

describe('hitungSpakGlobal', () => {
  it('data kosong: semua angka null, nol responden', () => {
    const h = hitungSpakGlobal([], PERIODE);
    expect(h).toMatchObject({ responden: 0, jawaban: 0, rata: null, indeks: null, persenSetuju: null, tren: [] });
    expect(h.butir).toHaveLength(5);
    expect(h.butir[0].distribusi).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('menghitung rata-rata, indeks, distribusi, dan persen setuju/netral/tidak setuju secara global', () => {
    const h = hitungSpakGlobal(
      [spak('2026-11-02T03:00:00Z', [6, 6, 6, 6, 6]), spak('2026-11-03T03:00:00Z', [5, 4, 3, 2, 1])],
      PERIODE,
    );
    expect(h.responden).toBe(2);
    expect(h.jawaban).toBe(10);
    expect(h.distribusi).toEqual([1, 1, 1, 1, 1, 5]);
    expect(h.rata).toBeCloseTo(4.5, 10); // (30 + 15) / 10
    expect(h.indeks).toBeCloseTo(75, 10); // 4,5 / 6 x 100
    expect(h.persenSetuju).toBeCloseTo(60, 10); // nilai 5 dan 6: 1 + 5 dari 10 jawaban
    expect(h.persenNetral).toBeCloseTo(20, 10); // nilai 3 dan 4
    expect(h.persenTidakSetuju).toBeCloseTo(20, 10); // nilai 1 dan 2
    expect(h.butir[0]).toMatchObject({ kunci: 'p1', jawaban: 2, distribusi: [0, 0, 0, 0, 1, 1] });
    expect(h.butir[0].persenSetuju).toBe(100);
    expect(h.butir[4].persenTidakSetuju).toBe(50);
  });

  it('nilai di luar rentang atau bukan bilangan bulat diabaikan, bukan dihitung', () => {
    const rusak = { ...spak('2026-11-02T03:00:00Z', [6, 6, 6, 6, 6]), p1_tanpa_diskriminasi: 9, p2_tanpa_kecurangan: '5', p3_tanpa_imbalan: 2.5 };
    const h = hitungSpakGlobal([rusak], PERIODE);
    expect(h.jawaban).toBe(2);
    expect(h.butir[0].jawaban).toBe(0);
  });

  it('tren harian memakai tanggal WIB (17:30Z = 00:30 WIB hari berikutnya)', () => {
    const h = hitungSpakGlobal(
      [spak('2026-11-02T17:30:00Z', [6, 6, 6, 6, 6]), spak('2026-11-03T03:00:00Z', [3, 3, 3, 3, 3])],
      PERIODE,
    );
    expect(h.kelompokTren).toBe('hari');
    expect(h.tren).toEqual([{ periode: '2026-11-03', responden: 2, nilai: 75 }]);
  });

  it('rentang lebih dari 62 hari dikelompokkan bulanan', () => {
    expect(kelompokPeriode('2026-01-01', '2026-03-04')).toBe('hari'); // 62 hari
    expect(kelompokPeriode('2026-01-01', '2026-03-05')).toBe('bulan');
    const h = hitungSpakGlobal(
      [spak('2026-01-10T03:00:00Z', [6, 6, 6, 6, 6]), spak('2026-02-10T03:00:00Z', [3, 3, 3, 3, 3])],
      { dari: '2026-01-01', sampai: '2026-12-31' },
    );
    expect(h.tren.map((t) => t.periode)).toEqual(['2026-01', '2026-02']);
  });

  it('tidak membedakan layanan: baris dari layanan berbeda digabung menjadi satu angka', () => {
    const a = spak('2026-11-02T03:00:00Z', [6, 6, 6, 6, 6]);
    const b = { ...spak('2026-11-02T04:00:00Z', [2, 2, 2, 2, 2]), layanan_id: 'lain', unit: 'fo' };
    expect(hitungSpakGlobal([a, b], PERIODE).rata).toBe(4);
  });
});

describe('hitungIkmGlobal', () => {
  it('data kosong', () => {
    const h = hitungIkmGlobal([], PERIODE);
    expect(h).toMatchObject({ responden: 0, ikm: null, mutu: null, mutuLabel: 'N/A' });
    expect(h.unsur).toHaveLength(11);
  });

  it('IKM = rata-rata skor responden x 25; unsur 10-11 kosong pada data lama tidak ikut', () => {
    const h = hitungIkmGlobal([skm('2026-11-02T03:00:00Z', 4), skm('2026-11-02T04:00:00Z', 3, 3, 3)], PERIODE);
    // responden 1: 9 unsur x4 -> 100; responden 2: 11 unsur x3 -> 75; rata-rata 87,5 -> B
    expect(h.responden).toBe(2);
    expect(h.ikm).toBeCloseTo(87.5, 10);
    expect(h.mutu).toBe('B');
    expect(h.sebaranMutu).toEqual({ A: 1, B: 0, C: 1, D: 0 });
    const u1 = h.unsur[0];
    expect(u1).toMatchObject({ kunci: 'u1', jawaban: 2, distribusi: [0, 0, 1, 1] });
    expect(u1.nilai).toBeCloseTo(87.5, 10);
    expect(h.unsur[9]).toMatchObject({ kunci: 'u10', jawaban: 1 });
    expect(h.unsur[9].rata).toBe(3);
  });

  it('predikat mengikuti batas 88/76/60', () => {
    expect(hitungIkmGlobal([skm('2026-11-02T03:00:00Z', 4)], PERIODE).mutu).toBe('A');
    expect(hitungIkmGlobal([skm('2026-11-02T03:00:00Z', 2)], PERIODE).mutu).toBe('D');
  });
});
