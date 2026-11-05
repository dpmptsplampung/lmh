export type IkmQuality = 'A' | 'B' | 'C' | 'D' | null;

export interface IkmRow {
  layanan_id: string;
  layanan_nama: string;
  ikm: number | null;
  responden: number;
}

/**
 * Ambang mutu pelayanan (batas bawah, inklusif) pada skala IKM 25-100.
 * Sumber tunggal: PermenPANRB No. 14 Tahun 2017, Lampiran Bab V huruf A, Tabel II
 * (https://peraturan.bpk.go.id/Download/123385/PERMENPAN%20NOMOR%2014%20TAHUN%202017.pdf#page=19).
 * Semua teks ambang di aplikasi (panel, laporan cetak, ekspor) diturunkan dari sini; jangan menulis angkanya di tempat lain.
 */
export const AMBANG_IKM = {
  A: 88.31,
  B: 76.61,
  C: 65,
  rujukan: 'PermenPANRB No. 14 Tahun 2017, Lampiran Bab V huruf A, Tabel II',
} as const;

const koma = (n: number) => n.toFixed(2).replace('.', ',');
// Batas atas kelas = batas bawah kelas di atasnya dikurangi 0,01 (nilai IKM dibulatkan dua desimal pada tabel resmi).
const atas = (n: number) => koma(Math.round((n - 0.01) * 100) / 100);

/** Rentang tiap mutu untuk ditampilkan (turunan AMBANG_IKM). */
export const RENTANG_MUTU_IKM: { kode: 'A' | 'B' | 'C' | 'D'; label: string; rentang: string }[] = [
  { kode: 'A', label: 'Sangat Baik', rentang: `${koma(AMBANG_IKM.A)} - 100` },
  { kode: 'B', label: 'Baik', rentang: `${koma(AMBANG_IKM.B)} - ${atas(AMBANG_IKM.A)}` },
  { kode: 'C', label: 'Kurang Baik', rentang: `${koma(AMBANG_IKM.C)} - ${atas(AMBANG_IKM.B)}` },
  { kode: 'D', label: 'Tidak Baik', rentang: `di bawah ${koma(AMBANG_IKM.C)}` },
];

/** Satu kalimat ambang untuk catatan kaki laporan. */
export const KETERANGAN_AMBANG_IKM =
  `A ≥ ${koma(AMBANG_IKM.A)}; B ≥ ${koma(AMBANG_IKM.B)}; C ≥ ${koma(AMBANG_IKM.C)}; D di bawah ${koma(AMBANG_IKM.C)}`;

/** Kalimat predikat untuk lembar catatan ekspor. */
export const KETERANGAN_PREDIKAT_IKM =
  RENTANG_MUTU_IKM.map((m) => `${m.kode} (${m.rentang}) ${m.label}`).join('; ') + '.';

export function ikmQuality(ikm: number | null): IkmQuality {
  if (ikm === null || Number.isNaN(ikm)) return null;
  if (ikm >= AMBANG_IKM.A) return 'A';
  if (ikm >= AMBANG_IKM.B) return 'B';
  if (ikm >= AMBANG_IKM.C) return 'C';
  return 'D';
}

export function ikmQualityText(ikm: number | null): string {
  const q = ikmQuality(ikm);
  switch (q) {
    case 'A': return 'Sangat Baik';
    case 'B': return 'Baik';
    case 'C': return 'Kurang Baik';
    case 'D': return 'Tidak Baik';
    default: return 'N/A';
  }
}

export function ikmQualityLabel(ikm: number | null): string {
  const q = ikmQuality(ikm);
  return q ? `${q} — ${ikmQualityText(ikm)}` : 'N/A';
}

export function fmtIkm(v: number | null): string {
  if (v === null || Number.isNaN(v)) return '—';
  return v.toFixed(1);
}

export function summarizeIkm(rows: IkmRow[]): {
  totalResponden: number;
  scoredCount: number;
  avgIkm: number | null;
} {
  const totalResponden = rows.reduce((s, r) => s + r.responden, 0);
  const scored = rows.filter((r) => r.ikm !== null);
  const avgIkm = scored.length > 0
    ? scored.reduce((s, r) => s + (r.ikm as number), 0) / scored.length
    : null;
  return { totalResponden, scoredCount: scored.length, avgIkm };
}
