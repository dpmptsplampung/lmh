// Penyusun tampilan baca-saja Pendataan Khusus untuk Lihat Data (G5b): mengubah muatan GET /api/admin/pelayanan/[tiketId]
// (`khusus`, `definisi_khusus`, `draf`) menjadi baris siap tampil. Fungsi murni, tanpa React dan tanpa I/O.
import { formatNilaiKhusus } from '@/lib/pendataan-khusus/jawaban';

export interface JawabanFinalApi {
  penanganan_id: string;
  field_id: string;
  label: string;
  jenis: string;
  nilai: unknown;
  tersembunyi: boolean;
  urut: number;
}

export interface DefinisiKhususApi {
  id: string;
  label: string;
  jenis: string;
  tersembunyi: boolean;
  urut: number;
}

export interface DrafApi {
  jawaban: Record<string, unknown>;
  updated_at: string;
}

export interface BarisKhusus {
  kunci: string;
  label: string;
  /** null = belum diisi. */
  teks: string | null;
  tersembunyi: boolean;
}

export interface TahapKhusus {
  kunci: string;
  baris: BarisKhusus[];
}

export function teksNilai(jenis: string, nilai: unknown): string | null {
  const hasil = formatNilaiKhusus({ jenis }, nilai);
  if (hasil === null || hasil === undefined) return null;
  const teks = String(hasil);
  return teks.trim() === '' ? null : teks;
}

/** Jawaban final per tahap (penanganan), urutan dari server dipertahankan; label memakai definisi TERBARU. */
export function susunJawabanFinal(khusus: readonly JawabanFinalApi[]): TahapKhusus[] {
  const tahap = new Map<string, TahapKhusus>();
  for (const j of khusus) {
    let t = tahap.get(j.penanganan_id);
    if (!t) {
      t = { kunci: j.penanganan_id, baris: [] };
      tahap.set(j.penanganan_id, t);
    }
    t.baris.push({
      kunci: `${j.penanganan_id}:${j.field_id}`,
      label: j.label,
      teks: teksNilai(j.jenis, j.nilai),
      tersembunyi: j.tersembunyi,
    });
  }
  return [...tahap.values()];
}

/** Draf: satu baris per definisi (terlihat dahulu, urut); isian tersembunyi hanya bila ada jawabannya. */
export function susunDraf(draf: DrafApi, definisi: readonly DefinisiKhususApi[]): BarisKhusus[] {
  const urut = [...definisi].sort((a, b) => Number(a.tersembunyi) - Number(b.tersembunyi) || a.urut - b.urut);
  const baris: BarisKhusus[] = [];
  for (const d of urut) {
    const nilai = draf.jawaban?.[d.id];
    if (d.tersembunyi && (nilai === undefined || nilai === null)) continue;
    baris.push({ kunci: d.id, label: d.label, teks: teksNilai(d.jenis, nilai), tersembunyi: d.tersembunyi });
  }
  return baris;
}
