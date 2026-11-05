import type { CSSProperties } from 'react';
import { formatAngka } from '../format';
import styles from './TooltipGrafik.module.css';

interface Muatan {
  name?: string | number;
  value?: unknown;
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
}

export interface TooltipGrafikProps {
  active?: boolean;
  payload?: ReadonlyArray<Muatan>;
  label?: string | number;
  formatNilai?: (n: number) => string;
  /** Peta kunci -> {label, warna}; label seri lebih baik daripada nama kunci mentah. */
  seri?: Record<string, { label: string; warna: string }>;
  /** Pakai nama titik data (mis. irisan donat) sebagai label baris. */
  pakaiNamaTitik?: boolean;
}

// Tooltip putih radius 12px, angka id-ID. Konten untuk <Tooltip content={...}>.
export default function TooltipGrafik({ active, payload, label, formatNilai = formatAngka, seri, pakaiNamaTitik }: TooltipGrafikProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className={styles.tooltip}>
      {!pakaiNamaTitik && label !== undefined && <p className={styles.judul}>{label}</p>}
      <ul className={styles.daftar}>
        {payload.map((m, i) => {
          const kunci = String(m.dataKey ?? m.name ?? i);
          const info = seri?.[kunci];
          const nilai = typeof m.value === 'number' ? formatNilai(m.value) : String(m.value ?? '-');
          const nama = pakaiNamaTitik ? String(m.name ?? '') : (info?.label ?? String(m.name ?? kunci));
          const warna = info?.warna ?? m.color;
          return (
            <li key={`${kunci}-${i}`} className={styles.baris}>
              <span className={styles.titik} style={{ '--warna': warna } as CSSProperties} aria-hidden="true" />
              <span className={styles.nama}>{nama}</span>
              <span className={styles.nilai}>{nilai}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
