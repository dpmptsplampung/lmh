export type IkmQuality = 'A' | 'B' | 'C' | 'D' | null;

export interface IkmRow {
  layanan_id: string;
  layanan_nama: string;
  ikm: number | null;
  responden: number;
}

export function ikmQuality(ikm: number | null): IkmQuality {
  if (ikm === null || Number.isNaN(ikm)) return null;
  if (ikm >= 88) return 'A';
  if (ikm >= 76) return 'B';
  if (ikm >= 60) return 'C';
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
