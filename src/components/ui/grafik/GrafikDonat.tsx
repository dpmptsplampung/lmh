'use client';

import type { CSSProperties, ReactNode } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { formatAngka } from '../format';
import TooltipGrafik from './TooltipGrafik';
import { useReducedMotion } from './useReducedMotion';
import styles from './GrafikDonat.module.css';

export interface IrisanDonat {
  nama: string;
  nilai: number;
  /** Warna CSS (token); bawaan var(--chart-N) menurut urutan. */
  warna?: string;
}

export interface GrafikDonatProps {
  data: IrisanDonat[];
  /** Teks di tengah lubang, mis. total. */
  tengah?: { nilai: ReactNode; label: string };
  label: string;
  /** Diameter dalam px. */
  ukuran?: number;
  formatNilai?: (n: number) => string;
}

// Donat + daftar legenda bernilai (DOM biasa, jadi terbaca pembaca layar tanpa bergantung pada SVG).
export default function GrafikDonat({ data, tengah, label, ukuran = 180, formatNilai = formatAngka }: GrafikDonatProps) {
  const reduced = useReducedMotion();
  const total = data.reduce((j, d) => j + d.nilai, 0);
  const dengan = data.map((d, i) => ({ ...d, warna: d.warna ?? `var(--chart-${(i % 6) + 1})` }));
  return (
    <div className={styles.wadah} role="group" aria-label={label}>
      <div className={styles.donat} style={{ width: ukuran, height: ukuran }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: ukuran, height: ukuran }}>
          <PieChart accessibilityLayer>
            <Tooltip content={<TooltipGrafik formatNilai={formatNilai} pakaiNamaTitik />} />
            <Pie
              data={dengan}
              dataKey="nilai"
              nameKey="nama"
              innerRadius="68%"
              outerRadius="100%"
              paddingAngle={total > 0 ? 2 : 0}
              stroke="none"
              isAnimationActive={!reduced}
            >
              {dengan.map((d) => (
                <Cell key={d.nama} fill={d.warna} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        {tengah && (
          <div className={styles.tengah}>
            <span className={styles.tengahNilai}>{tengah.nilai}</span>
            <span className={styles.tengahLabel}>{tengah.label}</span>
          </div>
        )}
      </div>
      <ul className={styles.legenda}>
        {dengan.map((d) => (
          <li key={d.nama} className={styles.baris}>
            <span className={styles.sampel} style={{ '--warna': d.warna } as CSSProperties} aria-hidden="true" />
            <span className={styles.nama}>{d.nama}</span>
            <span className={styles.nilai}>
              {formatNilai(d.nilai)}
              {total > 0 && <span className={styles.persen}> ({formatAngka((d.nilai / total) * 100, 0)}%)</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
