'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { formatAngka } from '../format';
import { useReducedMotion } from './useReducedMotion';
import styles from './Meteran.module.css';

export interface MeteranProps {
  nilai: number;
  /** Batas atas skala. Bawaan 100. */
  maks?: number;
  /** Ambang target (skala sama). Nilai >= target = hijau, di bawahnya = oranye. */
  target?: number;
  /** Nama meteran untuk pembaca layar. */
  label: string;
  /** Satuan di belakang angka tengah. Bawaan "%". */
  satuan?: string;
  /** Kalimat di bawah, mis. "Sesuai target 80%". */
  teks?: ReactNode;
  className?: string;
}

// Meteran setengah lingkaran (SVG murni). Makna selalu ada dalam teks: angka di tengah, role="meter" dengan
// aria-valuenow/min/max, dan `teks` di bawah; warna hanya penguat.
export default function Meteran({ nilai, maks = 100, target, label, satuan = '%', teks, className }: MeteranProps) {
  const reduced = useReducedMotion();
  const batas = Math.min(Math.max(nilai, 0), maks);
  const persen = maks > 0 ? (batas / maks) * 100 : 0;
  const nada = target === undefined ? 'primer' : nilai >= target ? 'sukses' : 'peringatan';
  const persenTarget = target !== undefined && maks > 0 ? Math.min(Math.max(target / maks, 0), 1) * 100 : null;

  // Posisi garis target di busur (sudut 180..0 derajat).
  const garisTarget = (() => {
    if (persenTarget === null) return null;
    const sudut = Math.PI * (1 - persenTarget / 100);
    const dalam = 38;
    const luar = 62;
    return {
      x1: 60 + dalam * Math.cos(sudut),
      y1: 62 - dalam * Math.sin(sudut),
      x2: 60 + luar * Math.cos(sudut),
      y2: 62 - luar * Math.sin(sudut),
    };
  })();

  return (
    <div className={cn(styles.wadah, className)}>
      <div
        className={styles.meter}
        role="meter"
        aria-label={label}
        aria-valuenow={Number(nilai.toFixed(2))}
        aria-valuemin={0}
        aria-valuemax={maks}
        aria-valuetext={`${formatAngka(nilai)}${satuan === '%' ? ' persen' : ` ${satuan}`}`}
      >
        <svg viewBox="0 0 120 70" className={styles.svg} aria-hidden="true" focusable="false">
          <path d="M 10 62 A 50 50 0 0 1 110 62" pathLength={100} className={styles.jalur} />
          <path
            d="M 10 62 A 50 50 0 0 1 110 62"
            pathLength={100}
            className={cn(styles.nilai, styles[nada], reduced && styles.tanpaGerak)}
            strokeDasharray="100"
            strokeDashoffset={100 - persen}
          />
          {garisTarget && <line {...garisTarget} className={styles.target} />}
        </svg>
        <p className={styles.angka}>
          {formatAngka(nilai)}
          <span className={styles.satuan}>{satuan}</span>
        </p>
      </div>
      {teks && <p className={styles.teks}>{teks}</p>}
    </div>
  );
}
