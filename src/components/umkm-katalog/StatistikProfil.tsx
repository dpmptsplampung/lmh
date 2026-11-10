import { Eye, Heart } from 'lucide-react';
import type { ElementType } from 'react';
import styles from './publik.module.css';

const tepat = new Intl.NumberFormat('id-ID');
const ringkas = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });

export function angkaRingkas(value: number) {
  if (value < 1000) return tepat.format(value);
  const [unit, label]: [number, string] = value >= 1e12 ? [1e12, 'triliun'] : value >= 1e9 ? [1e9, 'miliar']
    : value >= 1e6 ? [1e6, 'jt'] : [1000, 'rb'];
  return `${ringkas.format(Math.floor(value / unit * 10) / 10)} ${label}`;
}

export function AngkaStatistik({ nilai, label, ikon: Ikon }: {
  nilai: number; label: string; ikon?: ElementType<{ size?: number; 'aria-hidden'?: 'true' }>;
}) {
  return <span className={styles.angka}>
    <span aria-hidden="true">{Ikon && <Ikon size={15} aria-hidden="true" />}{angkaRingkas(nilai)} {label}</span>
    <span className="sr-only">{tepat.format(nilai)} {label}</span>
  </span>;
}

export default function StatistikProfil({ suka, dilihat, baru }: {
  suka: number; dilihat: number | null; baru: boolean;
}) {
  return <div className={styles.statistik}>
    {baru && <span className={styles.baru}>Baru</span>}
    <AngkaStatistik nilai={suka} label="Suka" ikon={Heart} />
    {dilihat !== null && <AngkaStatistik nilai={dilihat} label="Dilihat" ikon={Eye} />}
  </div>;
}
