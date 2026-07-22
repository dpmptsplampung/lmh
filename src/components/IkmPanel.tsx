'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { ClipboardList } from 'lucide-react';
import {
  fmtIkm,
  ikmQuality,
  ikmQualityLabel,
  summarizeIkm,
  type IkmRow,
} from '@/lib/ikm';
import styles from './IkmPanel.module.css';

const CHART_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

interface IkmPanelProps {
  rows: IkmRow[];
  periodLabel: string;
  mode: 'admin' | 'public';
}

export default function IkmPanel({ rows, periodLabel, mode }: IkmPanelProps) {
  const { totalResponden, scoredCount, avgIkm } = summarizeIkm(rows);

  const chartData = rows
    .filter((r) => r.ikm !== null)
    .map((r) => ({ nama: r.layanan_nama, ikm: Number((r.ikm as number).toFixed(1)) }));

  const chartEmptyText = mode === 'admin'
    ? 'Belum ada data IKM untuk periode ini'
    : 'Belum ada data IKM untuk kuartal ini';

  return (
    <>
      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <span className={styles.summaryValue}>{fmtIkm(avgIkm)}</span>
          <span className={styles.summaryLabel}>Rata-rata IKM</span>
          <span className={`${styles.qualityBadge} ${styles[`quality${ikmQuality(avgIkm) ?? 'D'}`]}`}>
            {ikmQualityLabel(avgIkm)}
          </span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryValue}>{totalResponden}</span>
          <span className={styles.summaryLabel}>Total Responden</span>
          <span className={styles.summaryLabel}>{periodLabel}</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryValue}>{rows.length}</span>
          <span className={styles.summaryLabel}>
            {mode === 'admin' ? 'Layanan Disurvei' : 'Layanan Aktif'}
          </span>
          <span className={styles.summaryLabel}>{scoredCount} dengan data</span>
        </div>
      </div>

      <div className={styles.chartCard}>
        <h3 className={styles.chartTitle}>Grafik IKM per Layanan</h3>
        <div className={styles.chartBody}>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 40, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="nama"
                  fontSize={11}
                  tickLine={false}
                  angle={-20}
                  textAnchor="end"
                  height={60}
                  interval={0}
                />
                <YAxis domain={[0, 100]} fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                  }}
                  formatter={(v) => [v as number, 'IKM']}
                />
                <Bar dataKey="ikm" radius={[6, 6, 0, 0]} name="IKM">
                  {chartData.map((entry, idx) => (
                    <Cell key={entry.nama} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className={styles.chartEmpty}>
              {chartEmptyText}
            </div>
          )}
        </div>
      </div>

      <div className={styles.tableSection}>
        {mode === 'admin' && <h3 className={styles.tableTitle}>Tabel IKM per Layanan</h3>}
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Layanan</th>
              <th>IKM</th>
              <th>Responden</th>
              <th>Predikat</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className={styles.tableEmpty}>
                  <ClipboardList size={20} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                  Belum ada data layanan
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.layanan_id}>
                  <td style={{ fontWeight: 500 }}>{r.layanan_nama}</td>
                  <td><span className={styles.ikmValue}>{fmtIkm(r.ikm)}</span></td>
                  <td>{r.responden}</td>
                  <td>
                    <span className={`${styles.qualityBadge} ${styles[`quality${ikmQuality(r.ikm) ?? 'D'}`]}`}>
                      {ikmQualityLabel(r.ikm)}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
