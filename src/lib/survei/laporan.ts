// Perhitungan angka untuk laporan Pesan Perilaku (grafik dan cetak). Modul murni: semua keluaran berupa angka agar bisa
// dihitung ulang, dibuat grafik, atau dicetak. Masukan = baris RPC ringkasan_* (rata-rata sudah dihitung di database).
import type { IkmRow } from '@/lib/ikm';
import { PERTANYAAN_SPAK, RENTANG, type KunciSpak } from './pertanyaan';

const KUNCI_SPAK = PERTANYAAN_SPAK.map((p) => p.kunci) as KunciSpak[];

export interface SpakBaris {
  layanan_id: string | null;
  unit: string;
  nama: string;
  responden: number;
  p1: number | string | null;
  p2: number | string | null;
  p3: number | string | null;
  p4: number | string | null;
  p5: number | string | null;
}

export interface ResponseRateBaris {
  layanan_id: string | null;
  unit: string;
  nama: string;
  diundang: number;
  mengisi: number;
}

export interface PengaduanBaris {
  jalur: string;
  sumber: string;
  status: string;
  jumlah: number;
}

export interface SaranBaris {
  layanan_id: string | null;
  unit: string;
  nama: string;
  jumlah: number;
}

export function angka(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** IKM keseluruhan = rata-rata IKM unit dibobot jumlah responden (unit tanpa nilai/responden tidak ikut). */
export function ikmGabungan(rows: IkmRow[]): { ikm: number | null; responden: number } {
  let bobot = 0;
  let jumlah = 0;
  for (const r of rows) {
    if (r.ikm === null || r.responden <= 0) continue;
    bobot += r.responden;
    jumlah += r.ikm * r.responden;
  }
  return { ikm: bobot > 0 ? jumlah / bobot : null, responden: bobot };
}

/** Rata-rata satu baris SPAK atas pernyataan yang terisi (skala 1-6). */
export function rataSpakBaris(r: SpakBaris): number | null {
  const nilai = KUNCI_SPAK.map((k) => angka(r[k])).filter((n): n is number => n !== null);
  return nilai.length ? nilai.reduce((a, b) => a + b, 0) / nilai.length : null;
}

/** Indeks SPAK skala 100 = rata-rata / nilai maksimum x 100 (6 = 100). */
export function indeksSpak(rata: number | null): number | null {
  return rata === null ? null : (rata / RENTANG.spak.max) * 100;
}

/** Rata-rata SPAK per pernyataan untuk semua unit, dibobot responden. */
export function spakGabungan(rows: SpakBaris[]): { p: Record<KunciSpak, number | null>; rata: number | null; responden: number } {
  const p = {} as Record<KunciSpak, number | null>;
  for (const k of KUNCI_SPAK) {
    let bobot = 0;
    let jumlah = 0;
    for (const r of rows) {
      const n = angka(r[k]);
      if (n === null || r.responden <= 0) continue;
      bobot += r.responden;
      jumlah += n * r.responden;
    }
    p[k] = bobot > 0 ? jumlah / bobot : null;
  }
  const nilai = KUNCI_SPAK.map((k) => p[k]).filter((n): n is number => n !== null);
  const responden = rows.reduce((s, r) => s + Math.max(0, r.responden), 0);
  return { p, rata: nilai.length ? nilai.reduce((a, b) => a + b, 0) / nilai.length : null, responden };
}

/** Persentase (0-100) atau null bila pembagi 0. */
export function persen(bagian: number, total: number): number | null {
  return total > 0 ? (bagian / total) * 100 : null;
}

export function responseRateGabungan(rows: ResponseRateBaris[]): { diundang: number; mengisi: number; persen: number | null } {
  const diundang = rows.reduce((s, r) => s + r.diundang, 0);
  const mengisi = rows.reduce((s, r) => s + r.mengisi, 0);
  return { diundang, mengisi, persen: persen(mengisi, diundang) };
}

export function jumlahPer<K extends string>(rows: PengaduanBaris[], kunci: (r: PengaduanBaris) => K): Record<K, number> {
  const hasil = {} as Record<K, number>;
  for (const r of rows) hasil[kunci(r)] = (hasil[kunci(r)] ?? 0) + r.jumlah;
  return hasil;
}

export const fmtAngka = (v: number | null, digit = 1): string => (v === null ? '—' : v.toFixed(digit));
export const fmtPersen = (v: number | null): string => (v === null ? '—' : `${v.toFixed(1)}%`);
