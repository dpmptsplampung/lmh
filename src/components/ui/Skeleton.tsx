import { cn } from '@/lib/utils';
import styles from './Skeleton.module.css';

export interface SkeletonProps {
  /** baris = teks/baris tabel, kartu = blok setinggi kartu KPI/grafik, angka = angka besar KPI. */
  bentuk?: 'baris' | 'kartu' | 'angka';
  jumlah?: number;
  /** Teks untuk pembaca layar; `false` bila halaman sudah punya pengumuman memuat sendiri. */
  label?: string | false;
  className?: string;
}

// Kerangka pemuatan (menggantikan spinner agar tata letak tidak melompat). Wadah aria-busy,
// bentuknya aria-hidden. Denyut mati saat prefers-reduced-motion (lihat CSS).
export default function Skeleton({ bentuk = 'baris', jumlah = 1, label = 'Memuat…', className }: SkeletonProps) {
  const n = Math.max(1, Math.floor(jumlah));
  return (
    <div className={cn(styles.wadah, styles[`wadah_${bentuk}`], className)} aria-busy="true">
      {label !== false && <span className="sr-only">{label}</span>}
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={cn(styles.blok, styles[bentuk])} aria-hidden="true" />
      ))}
    </div>
  );
}
