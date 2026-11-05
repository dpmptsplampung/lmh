import Link from 'next/link';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import type { ElementType, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { formatAngka, ucapkanPersen } from './format';
import Lencana, { type NadaLencana } from './Lencana';
import Skeleton from './Skeleton';
import styles from './KartuStatistik.module.css';

export type ArahTren = 'naik' | 'turun' | 'datar';

export interface TrenStatistik {
  /** Besar perubahan dalam persen, tanpa tanda (15.5 = 15,5 persen). */
  persen: number;
  arah: ArahTren;
  /** Arah yang berarti baik. Bawaan `naik`; waktu tunggu memakai `turun` (turun = hijau). */
  arahBaik?: 'naik' | 'turun';
}

export interface KartuStatistikProps {
  label: string;
  nilai: ReactNode;
  /** Komponen ikon (lucide), digambar 18px di kanan atas. */
  ikon?: ElementType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean | 'true' }>;
  tren?: TrenStatistik;
  /** Baris pembanding, mis. "vs 14.653 periode lalu". */
  pembanding?: string;
  /** Bila ada, seluruh kartu menjadi tautan. */
  href?: string;
  memuat?: boolean;
  className?: string;
}

export function nadaTren(tren: TrenStatistik): NadaLencana {
  if (tren.arah === 'datar') return 'netral';
  return tren.arah === (tren.arahBaik ?? 'naik') ? 'sukses' : 'bahaya';
}

function ucapanTren(tren: TrenStatistik): string {
  if (tren.arah === 'datar') return 'tidak berubah';
  return `${tren.arah} ${ucapkanPersen(tren.persen)}`;
}

// Kartu KPI. Arah tren dikatakan dalam teks (untuk pembaca layar) dan ikon, tidak hanya lewat warna.
export default function KartuStatistik({ label, nilai, ikon: Ikon, tren, pembanding, href, memuat = false, className }: KartuStatistikProps) {
  const IkonTren = tren ? (tren.arah === 'naik' ? TrendingUp : tren.arah === 'turun' ? TrendingDown : Minus) : null;
  const isi = (
    <>
      <div className={styles.kepala}>
        <p className={styles.label}>{label}</p>
        {Ikon && (
          <span className={styles.ikon}>
            <Ikon size={18} strokeWidth={1.75} aria-hidden="true" />
          </span>
        )}
      </div>
      {memuat ? (
        <Skeleton bentuk="angka" label={`Memuat ${label}`} />
      ) : (
        <>
          <div className={styles.barisNilai}>
            <p className={styles.nilai}>{typeof nilai === 'number' ? formatAngka(nilai) : nilai}</p>
            {tren && IkonTren && (
              <Lencana nada={nadaTren(tren)} ikon={IkonTren}>
                <span aria-hidden="true">{tren.arah === 'datar' ? '0%' : `${formatAngka(tren.persen)}%`}</span>
                <span className="sr-only">{ucapanTren(tren)}</span>
              </Lencana>
            )}
          </div>
          {pembanding && <p className={styles.pembanding}>{pembanding}</p>}
        </>
      )}
    </>
  );
  const kelas = cn(styles.kartu, href && styles.tautan, className);
  if (href) {
    return (
      <Link href={href} className={kelas} aria-busy={memuat || undefined}>
        {isi}
      </Link>
    );
  }
  return (
    <div className={kelas} aria-busy={memuat || undefined}>
      {isi}
    </div>
  );
}
