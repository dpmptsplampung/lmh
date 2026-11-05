'use client';

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatAngka } from '../format';
import TooltipGrafik from './TooltipGrafik';
import type { BarisData } from './tipe';
import { useReducedMotion } from './useReducedMotion';

export interface GrafikBatangProps {
  data: BarisData[];
  sumbuX: string;
  /** Kunci nilai batang. */
  nilai: string;
  /** Nama nilai untuk tooltip. */
  labelNilai: string;
  /** Batang yang disorot (biru); lainnya abu muda. Nilai sumbu X atau fungsi penentu. Kosong = semua biru. */
  sorot?: Array<string | number> | ((baris: BarisData, indeks: number) => boolean);
  /** Label angka di atas batang: hanya yang disorot (bawaan), semua, atau tidak ada. */
  labelAngka?: 'sorot' | 'semua' | 'tanpa';
  label: string;
  tinggi?: number;
  formatNilai?: (n: number) => string;
}

const TICK = { fill: 'var(--chart-axis)', fontSize: 12 } as const;

// Batang vertikal dengan sorotan. Batang non-sorot nyaris tak terlihat (1,23:1), jadi makna tidak boleh hanya di
// warna: label angka ada di batang sorot dan PanelGrafik menyediakan tabel cadangan.
export default function GrafikBatang({
  data,
  sumbuX,
  nilai,
  labelNilai,
  sorot,
  labelAngka = 'sorot',
  label,
  tinggi = 240,
  formatNilai = formatAngka,
}: GrafikBatangProps) {
  const reduced = useReducedMotion();
  const disorot = (b: BarisData, i: number) => {
    if (sorot === undefined) return true;
    if (typeof sorot === 'function') return sorot(b, i);
    return sorot.includes(b[sumbuX] as string | number);
  };
  const peta = { [nilai]: { label: labelNilai, warna: 'var(--chart-1)' } };

  return (
    <div role="group" aria-label={label} style={{ width: '100%', height: tinggi }}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: tinggi }}>
        <BarChart data={data} accessibilityLayer margin={{ top: 20, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="4 4" />
          <XAxis dataKey={sumbuX} tickLine={false} axisLine={false} tick={TICK} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} tick={TICK} width={44} tickFormatter={(v) => formatNilai(Number(v))} />
          <Tooltip cursor={{ fill: 'var(--bg-surface-hover)' }} content={<TooltipGrafik formatNilai={formatNilai} seri={peta} />} />
          <Bar dataKey={nilai} name={labelNilai} radius={[6, 6, 0, 0]} maxBarSize={44} isAnimationActive={!reduced}>
            {data.map((b, i) => (
              <Cell key={i} fill={disorot(b, i) ? 'var(--chart-1)' : 'var(--chart-bar-muted)'} />
            ))}
            {labelAngka !== 'tanpa' && (
              <LabelList
                dataKey={nilai}
                position="top"
                content={(p) => {
                  const idx = Number(p.index ?? 0);
                  if (labelAngka === 'sorot' && !disorot(data[idx], idx)) return null;
                  const x = Number(p.x ?? 0) + Number(p.width ?? 0) / 2;
                  const y = Number(p.y ?? 0) - 6;
                  return (
                    <text x={x} y={y} textAnchor="middle" fill="var(--text-primary)" fontSize={12} fontWeight={600}>
                      {formatNilai(Number(p.value ?? 0))}
                    </text>
                  );
                }}
              />
            )}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
