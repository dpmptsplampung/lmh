'use client';

import { useId } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatAngka } from '../format';
import TooltipGrafik from './TooltipGrafik';
import { warnaSeri, type BarisData, type SeriGrafik } from './tipe';
import { useReducedMotion } from './useReducedMotion';

export interface GrafikGarisProps {
  data: BarisData[];
  /** Kunci sumbu X (label kategori/tanggal yang sudah diformat). */
  sumbuX: string;
  seri: SeriGrafik[];
  /** Nama grafik untuk pembaca layar. */
  label: string;
  tinggi?: number;
  formatNilai?: (n: number) => string;
}

const TICK = { fill: 'var(--chart-axis)', fontSize: 12 } as const;

// Grafik garis/area. Sumbu tanpa garis, kisi horizontal putus-putus, tooltip putih, animasi mati bila
// prefers-reduced-motion, accessibilityLayer aktif (panah kiri/kanan menelusuri titik). Pasangkan dengan PanelGrafik
// yang menyediakan tabel cadangan.
export default function GrafikGaris({ data, sumbuX, seri, label, tinggi = 240, formatNilai = formatAngka }: GrafikGarisProps) {
  const reduced = useReducedMotion();
  const idDasar = useId().replace(/[^a-zA-Z0-9]/g, '');
  const peta = Object.fromEntries(seri.map((s, i) => [s.kunci, { label: s.label, warna: warnaSeri(s, i) }]));
  return (
    <div role="group" aria-label={label} style={{ width: '100%', height: tinggi }}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: tinggi }}>
        <AreaChart data={data} accessibilityLayer margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            {seri.map((s, i) =>
              s.area ? (
                <linearGradient key={s.kunci} id={`${idDasar}-${s.kunci}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={warnaSeri(s, i)} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={warnaSeri(s, i)} stopOpacity={0} />
                </linearGradient>
              ) : null,
            )}
          </defs>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="4 4" />
          <XAxis dataKey={sumbuX} tickLine={false} axisLine={false} tick={TICK} tickMargin={8} minTickGap={16} />
          <YAxis tickLine={false} axisLine={false} tick={TICK} width={44} tickFormatter={(v) => formatNilai(Number(v))} />
          <Tooltip
            cursor={{ stroke: 'var(--chart-grid)' }}
            content={<TooltipGrafik formatNilai={formatNilai} seri={peta} />}
          />
          {seri.map((s, i) => (
            <Area
              key={s.kunci}
              type="monotone"
              dataKey={s.kunci}
              name={s.label}
              stroke={warnaSeri(s, i)}
              strokeWidth={2}
              strokeDasharray={s.putus ? '5 4' : undefined}
              fill={s.area ? `url(#${idDasar}-${s.kunci})` : 'none'}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls
              isAnimationActive={!reduced}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
