// Ringkasan GLOBAL hasil Pesan Perilaku (SPAK dan IKM): seluruh pelayanan digabung, TANPA pemecahan per Layanan/unit
// (keputusan pemilik 2026-11-03). Modul murni: masukannya baris jawaban mentah (spak_respons / skm_respons), keluarannya angka siap
// tampil, unduh, atau cetak. Persentase memakai penyebut jumlah JAWABAN (bukan responden) bila disebut "jawaban".
import { ikmQuality, ikmQualityLabel, type IkmQuality } from '@/lib/ikm';
import { toWIBDateString } from '@/lib/time';
import { PERTANYAAN_SPAK, RENTANG, UNSUR_SKM, type KunciSkm, type KunciSpak } from './pertanyaan';

export const KOLOM_SPAK: Record<KunciSpak, string> = {
  p1: 'p1_tanpa_diskriminasi',
  p2: 'p2_tanpa_kecurangan',
  p3: 'p3_tanpa_imbalan',
  p4: 'p4_tanpa_pungli',
  p5: 'p5_tanpa_percaloan',
};
export const KOLOM_SKM: Record<KunciSkm, string> = {
  u1: 'u1_persyaratan', u2: 'u2_prosedur', u3: 'u3_waktu', u4: 'u4_biaya', u5: 'u5_produk', u6: 'u6_kompetensi',
  u7: 'u7_perilaku', u8: 'u8_sarana', u9: 'u9_pengaduan', u10: 'u10_transparansi', u11: 'u11_integritas',
};

/** Baris mentah: hanya waktu jawab dan kolom nilai yang dibaca (tanpa identitas, tanpa layanan). */
export type BarisMentah = { created_at: string } & Record<string, unknown>;

/** Nilai SPAK >= 5 (Setuju, Sangat Setuju) dianggap setuju; <= 2 tidak setuju; 3-4 netral. */
export const AMBANG_SETUJU = 5;
export const AMBANG_TIDAK_SETUJU = 2;

export const persen = (bagian: number, total: number): number | null => (total > 0 ? (bagian / total) * 100 : null);

function nilai(r: BarisMentah, kolom: string, min: number, maks: number): number | null {
  const v = r[kolom];
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= maks ? v : null;
}

const rata = (angka: number[]): number | null => (angka.length ? angka.reduce((a, b) => a + b, 0) / angka.length : null);

export interface TitikTren {
  /** 'YYYY-MM-DD' (harian) atau 'YYYY-MM' (bulanan, untuk rentang > 62 hari). */
  periode: string;
  responden: number;
  /** Indeks SPAK atau IKM (skala 0-100) responden pada periode itu. */
  nilai: number | null;
}

/** Harian bila rentang <= 62 hari, selain itu bulanan. Periode tanpa jawaban tidak dimunculkan. */
export function kelompokPeriode(dari: string, sampai: string): 'hari' | 'bulan' {
  const selisih = (Date.parse(`${sampai}T00:00:00Z`) - Date.parse(`${dari}T00:00:00Z`)) / 86_400_000;
  return selisih > 62 ? 'bulan' : 'hari';
}

function tren(baris: { created_at: string; skor: number | null }[], mode: 'hari' | 'bulan'): TitikTren[] {
  const peta = new Map<string, number[]>();
  const respondenPer = new Map<string, number>();
  for (const b of baris) {
    const hari = toWIBDateString(new Date(b.created_at));
    const kunci = mode === 'bulan' ? hari.slice(0, 7) : hari;
    respondenPer.set(kunci, (respondenPer.get(kunci) ?? 0) + 1);
    if (b.skor !== null) peta.set(kunci, [...(peta.get(kunci) ?? []), b.skor]);
  }
  return [...respondenPer.keys()].sort().map((periode) => ({
    periode,
    responden: respondenPer.get(periode) ?? 0,
    nilai: rata(peta.get(periode) ?? []),
  }));
}

// ---------------------------------------------------------------- SPAK

export interface ButirSpak {
  kunci: KunciSpak;
  teks: string;
  /** Jumlah jawaban yang sah untuk butir ini. */
  jawaban: number;
  /** Rata-rata skala 1-6. */
  rata: number | null;
  /** Rata-rata / 6 x 100. */
  indeks: number | null;
  /** Banyak jawaban per nilai 1..6 (indeks 0 = nilai 1). */
  distribusi: number[];
  persenSetuju: number | null;
  persenNetral: number | null;
  persenTidakSetuju: number | null;
}

export interface RingkasanSpakGlobal {
  responden: number;
  jawaban: number;
  rata: number | null;
  indeks: number | null;
  persenSetuju: number | null;
  persenNetral: number | null;
  persenTidakSetuju: number | null;
  distribusi: number[];
  butir: ButirSpak[];
  tren: TitikTren[];
  kelompokTren: 'hari' | 'bulan';
}

export const indeksSpakDari = (r: number | null): number | null => (r === null ? null : (r / RENTANG.spak.max) * 100);

export function hitungSpakGlobal(rows: BarisMentah[], periode: { dari: string; sampai: string }): RingkasanSpakGlobal {
  const { min, max } = RENTANG.spak;
  const distTotal = Array<number>(max).fill(0);

  const butir = PERTANYAAN_SPAK.map((p): ButirSpak => {
    const dist = Array<number>(max).fill(0);
    for (const r of rows) {
      const v = nilai(r, KOLOM_SPAK[p.kunci], min, max);
      if (v !== null) {
        dist[v - 1] += 1;
        distTotal[v - 1] += 1;
      }
    }
    return {
      kunci: p.kunci,
      teks: p.teks,
      ...ringkasDistribusi(dist),
    };
  });

  const jawaban = distTotal.reduce((a, b) => a + b, 0);
  const total = ringkasDistribusi(distTotal);
  const mode = kelompokPeriode(periode.dari, periode.sampai);
  const skorBaris = rows.map((r) => {
    const v = PERTANYAAN_SPAK.map((p) => nilai(r, KOLOM_SPAK[p.kunci], min, max)).filter((n): n is number => n !== null);
    return { created_at: r.created_at, skor: indeksSpakDari(rata(v)) };
  });

  return {
    responden: rows.length,
    jawaban,
    rata: total.rata,
    indeks: total.indeks,
    persenSetuju: total.persenSetuju,
    persenNetral: total.persenNetral,
    persenTidakSetuju: total.persenTidakSetuju,
    distribusi: distTotal,
    butir,
    tren: tren(skorBaris, mode),
    kelompokTren: mode,
  };
}

function ringkasDistribusi(dist: number[]): Omit<ButirSpak, 'kunci' | 'teks'> {
  const jawaban = dist.reduce((a, b) => a + b, 0);
  const jumlah = dist.reduce((s, n, i) => s + n * (i + 1), 0);
  const rataNilai = jawaban > 0 ? jumlah / jawaban : null;
  const hitung = (f: (nilai: number) => boolean) => dist.reduce((s, n, i) => s + (f(i + 1) ? n : 0), 0);
  return {
    jawaban,
    rata: rataNilai,
    indeks: indeksSpakDari(rataNilai),
    distribusi: dist,
    persenSetuju: persen(hitung((v) => v >= AMBANG_SETUJU), jawaban),
    persenNetral: persen(hitung((v) => v > AMBANG_TIDAK_SETUJU && v < AMBANG_SETUJU), jawaban),
    persenTidakSetuju: persen(hitung((v) => v <= AMBANG_TIDAK_SETUJU), jawaban),
  };
}

// ---------------------------------------------------------------- IKM

export interface UnsurIkm {
  kunci: KunciSkm;
  teks: string;
  jawaban: number;
  /** Rata-rata skala 1-4. */
  rata: number | null;
  /** Rata-rata x 25 (skala 25-100). */
  nilai: number | null;
  /** Banyak jawaban per nilai 1..4 (indeks 0 = nilai 1). */
  distribusi: number[];
}

export interface RingkasanIkmGlobal {
  responden: number;
  /** IKM = rata-rata nilai unsur yang terisi per responden, dirata-ratakan, x 25. */
  ikm: number | null;
  mutu: IkmQuality;
  mutuLabel: string;
  unsur: UnsurIkm[];
  /** Banyak responden menurut mutu IKM masing-masing. */
  sebaranMutu: Record<'A' | 'B' | 'C' | 'D', number>;
  tren: TitikTren[];
  kelompokTren: 'hari' | 'bulan';
}

export function hitungIkmGlobal(rows: BarisMentah[], periode: { dari: string; sampai: string }): RingkasanIkmGlobal {
  const { min, max } = RENTANG.skm;
  const unsur = UNSUR_SKM.map((u): UnsurIkm => {
    const dist = Array<number>(max).fill(0);
    for (const r of rows) {
      const v = nilai(r, KOLOM_SKM[u.kunci], min, max);
      if (v !== null) dist[v - 1] += 1;
    }
    const jawaban = dist.reduce((a, b) => a + b, 0);
    const r = jawaban > 0 ? dist.reduce((s, n, i) => s + n * (i + 1), 0) / jawaban : null;
    return { kunci: u.kunci, teks: u.teks, jawaban, rata: r, nilai: r === null ? null : r * 25, distribusi: dist };
  });

  const sebaranMutu = { A: 0, B: 0, C: 0, D: 0 };
  const skorBaris = rows.map((r) => {
    const v = UNSUR_SKM.map((u) => nilai(r, KOLOM_SKM[u.kunci], min, max)).filter((n): n is number => n !== null);
    const r2 = rata(v);
    const ikm = r2 === null ? null : r2 * 25;
    const mutu = ikmQuality(ikm);
    if (mutu) sebaranMutu[mutu] += 1;
    return { created_at: r.created_at, skor: ikm };
  });
  const ikm = rata(skorBaris.map((b) => b.skor).filter((n): n is number => n !== null));
  const mode = kelompokPeriode(periode.dari, periode.sampai);

  return {
    responden: rows.length,
    ikm,
    mutu: ikmQuality(ikm),
    mutuLabel: ikmQualityLabel(ikm),
    unsur,
    sebaranMutu,
    tren: tren(skorBaris, mode),
    kelompokTren: mode,
  };
}
