import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import styles from './Sparkline.module.css';

export interface SparklineProps {
  data: number[];
  /** Warna CSS (token). Bawaan var(--chart-1). */
  warna?: string;
  tinggi?: number;
  /** Bila diberikan, dibaca sebagai gambar bernama; kosong = dekoratif (aria-hidden). */
  label?: string;
  area?: boolean;
  className?: string;
}

// Garis mini tanpa sumbu (SVG murni, tanpa recharts) untuk KPI. Dekoratif kecuali `label` diberikan:
// angka yang sama harus sudah tertulis di dekatnya.
export default function Sparkline({ data, warna = 'var(--chart-1)', tinggi = 32, label, area = true, className }: SparklineProps) {
  const L = 100;
  const H = 24;
  const titik = data.filter((n) => Number.isFinite(n));
  if (titik.length < 2) return null;
  const min = Math.min(...titik);
  const maks = Math.max(...titik);
  const rentang = maks - min || 1;
  const koordinat = titik.map((n, i) => [(i / (titik.length - 1)) * L, H - 2 - ((n - min) / rentang) * (H - 4)] as const);
  const garis = koordinat.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
  const luas = `${garis} L${L} ${H} L0 ${H} Z`;
  return (
    <svg
      viewBox={`0 0 ${L} ${H}`}
      preserveAspectRatio="none"
      className={cn(styles.svg, className)}
      style={{ height: tinggi, '--warna': warna } as CSSProperties}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {area && <path d={luas} className={styles.luas} />}
      <path d={garis} className={styles.garis} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
