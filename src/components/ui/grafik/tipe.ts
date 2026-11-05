// Tipe bersama pembungkus grafik "Dasbor".

export type NilaiSel = string | number | null;
export type BarisData = Record<string, NilaiSel>;

export interface SeriGrafik {
  /** Kunci nilai pada tiap baris data. */
  kunci: string;
  /** Nama seri untuk tooltip, legenda, dan tabel cadangan. */
  label: string;
  /** Warna CSS, bawaan var(--chart-N) menurut urutan. Pakai token, bukan heksadesimal. */
  warna?: string;
  /** Garis putus-putus (mis. "periode lalu"); otomatis memakai var(--chart-compare) bila warna kosong. */
  putus?: boolean;
  /** Area gradasi lembut di bawah garis (GrafikGaris). */
  area?: boolean;
}

export interface KolomTabelGrafik {
  kunci: string;
  label: string;
}

/** Sumber tabel cadangan dan unduhan CSV. */
export interface TabelGrafik {
  kolom: KolomTabelGrafik[];
  baris: BarisData[];
}

export function warnaSeri(seri: SeriGrafik, indeks: number): string {
  if (seri.warna) return seri.warna;
  if (seri.putus) return 'var(--chart-compare)';
  return `var(--chart-${(indeks % 6) + 1})`;
}
