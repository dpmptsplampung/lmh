'use client';

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TitikTren } from '@/lib/survei/ringkasan-global';
import { WARNA_GARIS, WARNA_GRID, fmt1, labelPeriode } from './grafik';
import styles from './HasilGlobal.module.css';

// Tren indeks (0-100) per hari atau per bulan, seluruh pelayanan. Periode tanpa jawaban tidak digambar.
export default function TrenGrafik({ judul, namaNilai, tren, mode }: { judul: string; namaNilai: string; tren: TitikTren[]; mode: 'hari' | 'bulan' }) {
  const data = tren.filter((t) => t.nilai !== null).map((t) => ({ label: labelPeriode(t.periode), nilai: Number((t.nilai as number).toFixed(1)), responden: t.responden }));
  return (
    <section className={styles.kartu} aria-label={judul}>
      <h3 className={styles.judulKartu}>{judul}</h3>
      <p className={styles.subJudul}>Rata-rata {mode === 'bulan' ? 'per bulan' : 'per hari'}; hanya periode yang ada jawabannya.</p>
      {data.length < 2 ? (
        <p className={styles.kosong}>Tren muncul setelah ada jawaban pada sedikitnya dua {mode === 'bulan' ? 'bulan' : 'hari'} berbeda.</p>
      ) : (
        <div className={styles.grafik} role="img" aria-label={`${judul}: ${data.map((d) => `${d.label} ${d.nilai}`).join(', ')}`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
              <CartesianGrid stroke={WARNA_GRID} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" fontSize={11} tickLine={false} />
              <YAxis domain={[0, 100]} fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip formatter={(v, _n, p) => [`${fmt1(Number(v))} (${(p.payload as { responden: number }).responden} responden)`, namaNilai]} />
              <Line type="monotone" dataKey="nilai" stroke={WARNA_GARIS} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
