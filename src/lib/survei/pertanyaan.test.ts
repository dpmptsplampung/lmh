// @vitest-environment node
// Uji golden Pesan Perilaku (survei terpadu Fase A, Task 6): teks pertanyaan, label skala, dan pembagian langkah harus
// sama persis dengan Lampiran A spec (docs/superpowers/specs/2026-10-26-survei-terpadu-design.md). Kecocokan rentang
// dengan CHECK di migrasi diperiksa di supabase/migrations/survei_jawaban.test.ts.
import { describe, expect, it } from 'vitest';
import {
  LANGKAH,
  PERTANYAAN_SPAK,
  RENTANG,
  SKALA_SKM,
  SKALA_SPAK,
  SURVEI,
  UNSUR_SKM,
  type KunciSkm,
  type KunciSpak,
} from './pertanyaan';

const KUNCI_SPAK: KunciSpak[] = ['p1', 'p2', 'p3', 'p4', 'p5'];
const KUNCI_SKM: KunciSkm[] = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8', 'u9', 'u10', 'u11'];

describe('pertanyaan survei (golden Lampiran A)', () => {
  it('SPAK: lima kalimat persis Lampiran A, berurutan p1..p5', () => {
    expect(PERTANYAAN_SPAK.map((p) => p.kunci)).toEqual(KUNCI_SPAK);
    expect(PERTANYAAN_SPAK.map((p) => p.teks)).toEqual([
      'Tidak ada diskriminasi pelayanan pada unit layanan ini',
      'Tidak ada pelayanan diluar prosedur/kecurangan pelayanan pada unit layanan ini',
      'Tidak ada penerimaan imbalan uang/barang/fasilitas diluar ketentuan yang berlaku pada unit layanan ini',
      'Tidak ada pungutan liar (pungli) pada unit layanan ini',
      'Tidak ada percaloan/perantara tidak resmi pada unit layanan ini',
    ]);
  });

  it('SKM: sebelas nama unsur persis Lampiran A, berurutan u1..u11', () => {
    expect(UNSUR_SKM.map((u) => u.kunci)).toEqual(KUNCI_SKM);
    expect(UNSUR_SKM.map((u) => u.teks)).toEqual([
      'Persyaratan Pelayanan',
      'Prosedur Pelayanan',
      'Waktu Pelayanan',
      'Tarif Pelayanan',
      'Produk/Hasil Pelayanan',
      'Kemampuan Petugas Pelayanan',
      'Perilaku Petugas Pelayanan',
      'Kualitas Sarana dan Prasarana',
      'Mekanisme Pengaduan',
      'Transparansi Pelayanan',
      'Integritas Petugas Pelayanan',
    ]);
  });

  it('skala SPAK: enam label persis, 1 = Sangat Tidak Setuju sampai 6 = Sangat Setuju', () => {
    expect(SKALA_SPAK).toEqual([
      { nilai: 1, label: 'Sangat Tidak Setuju' },
      { nilai: 2, label: 'Tidak Setuju' },
      { nilai: 3, label: 'Kurang Setuju' },
      { nilai: 4, label: 'Cukup Setuju' },
      { nilai: 5, label: 'Setuju' },
      { nilai: 6, label: 'Sangat Setuju' },
    ]);
  });

  it('skala SKM: urutan tampil Sangat Baik (4), Baik (3), Cukup (2), Kurang (1)', () => {
    expect(SKALA_SKM).toEqual([
      { nilai: 4, label: 'Sangat Baik' },
      { nilai: 3, label: 'Baik' },
      { nilai: 2, label: 'Cukup' },
      { nilai: 1, label: 'Kurang' },
    ]);
  });

  it('judul dan instruksi SPAK, judul SKM', () => {
    expect(SURVEI.spak.judul).toBe('Survey Persepsi Anti Korupsi');
    expect(SURVEI.spak.instruksi).toBe('Berikan penilaian Anda dari skala 1-6 dengan keterangan sebagai berikut');
    // Judul bagian "A. PERTANYAAN TERKAIT ..." dihapus atas permintaan pemilik (2026-11-03).
    expect(SURVEI.spak).not.toHaveProperty('bagian');
    expect(SURVEI.skm.judul).toBe('Survey Kepuasan Masyarakat');
  });

  it('RENTANG: SPAK 1-6 dan SKM 1-4, selaras dengan nilai pada skala', () => {
    expect(RENTANG).toEqual({ spak: { min: 1, max: 6 }, skm: { min: 1, max: 4 } });
    expect(Math.min(...SKALA_SPAK.map((s) => s.nilai))).toBe(RENTANG.spak.min);
    expect(Math.max(...SKALA_SPAK.map((s) => s.nilai))).toBe(RENTANG.spak.max);
    expect(Math.min(...SKALA_SKM.map((s) => s.nilai))).toBe(RENTANG.skm.min);
    expect(Math.max(...SKALA_SKM.map((s) => s.nilai))).toBe(RENTANG.skm.max);
  });
});

describe('LANGKAH (5 langkah: SPAK 3+2, SKM 4+4+3)', () => {
  it('urutan dan pembagian persis Lampiran A', () => {
    expect(LANGKAH).toEqual([
      { survei: 'spak', kunci: ['p1', 'p2', 'p3'] },
      { survei: 'spak', kunci: ['p4', 'p5'] },
      { survei: 'skm', kunci: ['u1', 'u2', 'u3', 'u4'] },
      { survei: 'skm', kunci: ['u5', 'u6', 'u7', 'u8'] },
      { survei: 'skm', kunci: ['u9', 'u10', 'u11'] },
    ]);
    expect(LANGKAH).toHaveLength(5);
  });

  it('setiap kunci tampil tepat sekali, berurutan, dan tidak ada kunci di luar pertanyaan', () => {
    const semua = LANGKAH.flatMap((l) => [...l.kunci]);
    expect(semua).toEqual([...KUNCI_SPAK, ...KUNCI_SKM]);
    expect(new Set(semua).size).toBe(semua.length);
  });

  it('langkah SPAK hanya berisi kunci p, langkah SKM hanya kunci u', () => {
    for (const l of LANGKAH) {
      const awalan = l.survei === 'spak' ? 'p' : 'u';
      expect(l.kunci.every((k) => k.startsWith(awalan))).toBe(true);
    }
  });
});
