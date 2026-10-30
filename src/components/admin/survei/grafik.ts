// Warna grafik "Hasil Survei". Distribusi jawaban SPAK = skala berkutub (merah -> abu-abu -> teal): nilai rendah/tinggi dibedakan
// oleh hue DAN kecerahan, dan setiap petak selalu punya label (legenda + tabel), jadi tidak bergantung pada warna saja.
export const WARNA_SKALA_SPAK = ['#b91c1c', '#ef8f84', '#cfcfd4', '#8fcdc4', '#2a9d8f', '#0f6b62'] as const;
/** Satu hue (teal) untuk besaran tunggal: persen setuju, nilai IKM per unsur. */
export const WARNA_BESARAN = '#0f766e';
export const WARNA_GARIS = '#4338ca';
export const WARNA_GRID = '#e2e8f0';

export const fmt1 = (v: number | null | undefined): string => (v === null || v === undefined || Number.isNaN(v) ? '—' : v.toFixed(1));
export const fmtPersen = (v: number | null | undefined): string => (fmt1(v) === '—' ? '—' : `${fmt1(v)}%`);

export function labelPeriode(periode: string): string {
  const [y, m, d] = periode.split('-');
  if (d) return `${d}/${m}`;
  const bulan = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${bulan[Number(m) - 1] ?? m} ${y}`;
}
