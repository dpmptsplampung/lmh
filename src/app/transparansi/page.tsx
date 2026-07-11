'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
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
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  BarChart3,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import styles from './transparansi.module.css';

const CHART_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

interface LayananRow {
  id: string;
  nama: string;
}

interface IkmRow {
  layanan_id: string;
  layanan_nama: string;
  ikm: number | null;
  responden: number;
}

function currentQuarterRange(): { start: string; end: string } {
  const now = new Date();
  const qMonth = Math.floor(now.getMonth() / 3) * 3;
  const start = new Date(now.getFullYear(), qMonth, 1);
  const end = now.toISOString().split('T')[0];
  return { start: start.toISOString().split('T')[0], end };
}

function qualityClass(ikm: number | null): string {
  if (ikm === null || Number.isNaN(ikm)) return styles.qD;
  if (ikm >= 88) return styles.qA;
  if (ikm >= 76) return styles.qB;
  if (ikm >= 60) return styles.qC;
  return styles.qD;
}

function qualityText(ikm: number | null): string {
  if (ikm === null || Number.isNaN(ikm)) return 'N/A';
  if (ikm >= 88) return 'A — Sangat Baik';
  if (ikm >= 76) return 'B — Baik';
  if (ikm >= 60) return 'C — Kurang Baik';
  return 'D — Tidak Baik';
}

function fmtIkm(v: number | null): string {
  if (v === null || Number.isNaN(v)) return '—';
  return v.toFixed(1);
}

export default function TransparansiPage() {
  const [rows, setRows] = useState<IkmRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<string>('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const supabase = createClient();
      const { data: layananRaw, error: layananErr } = await supabase
        .from('layanan')
        .select('id, nama')
        .neq('tipe', 'modul_publik')
        .order('nama');

      if (layananErr) throw layananErr;
      const layananList = (layananRaw ?? []) as LayananRow[];

      const { start, end } = currentQuarterRange();

      const results = await Promise.all(
        layananList.map(async (l) => {
          const { data, error: rpcErr } = await supabase.rpc('hitung_ikm', {
            p_layanan_id: l.id,
            p_start: start,
            p_end: end,
          });
          if (rpcErr) {
            return { layanan_id: l.id, layanan_nama: l.nama, ikm: null, responden: 0 } as IkmRow;
          }
          const arr = (data ?? []) as Array<{ layanan_id: string; layanan_nama: string; ikm: number | null; responden: number }>;
          if (arr.length === 0) {
            return { layanan_id: l.id, layanan_nama: l.nama, ikm: null, responden: 0 } as IkmRow;
          }
          const r = arr[0];
          return {
            layanan_id: r.layanan_id,
            layanan_nama: r.layanan_nama ?? l.nama,
            ikm: r.ikm === null ? null : Number(r.ikm),
            responden: r.responden ?? 0,
          } as IkmRow;
        }),
      );

      setRows(results);
      setLastUpdated(new Date().toLocaleString('id-ID', {
        dateStyle: 'long',
        timeStyle: 'short',
      }));
    } catch (e) {
      console.error('Transparansi page error:', e);
      setError('Gagal memuat data IKM. Coba lagi nanti.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  const totalResponden = rows.reduce((s, r) => s + r.responden, 0);
  const scored = rows.filter((r) => r.ikm !== null);
  const avgIkm = scored.length > 0
    ? scored.reduce((s, r) => s + (r.ikm as number), 0) / scored.length
    : null;

  const chartData = rows
    .filter((r) => r.ikm !== null)
    .map((r) => ({ nama: r.layanan_nama, ikm: Number((r.ikm as number).toFixed(1)) }));

  return (
    <div className={styles.tPage}>
      <div className={styles.tCard}>
        <Link href="/" className={styles.tBackLink}>
          <ArrowLeft size={16} />
          Kembali ke Beranda
        </Link>

        <div className={styles.tHeader}>
          <h1 className={styles.tTitle}>Transparansi Layanan — IKM Publik</h1>
          <p className={styles.tSubtitle}>
            Indeks Kepuasan Masyarakat (PermenPANRB 14/2017) — Kuartal Ini
          </p>
        </div>

        <div className={styles.tIntro}>
          Halaman ini menampilkan hasil Survei Kepuasan Masyarakat secara agregat
          per layanan. Tidak ada data pribadi yang ditampilkan. IKM dihitung dari
          9 unsur kepuasan dengan skala 25-100.
        </div>

        {error && (
          <div className={styles.tError} role="alert">
            <AlertCircle size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            {error}
          </div>
        )}

        {loading ? (
          <div className={styles.tLoading}>
            <Loader2 size={28} className="animate-pulse" />
          </div>
        ) : (
          <>
            <div className={styles.tSummaryGrid}>
              <div className={styles.tSummaryCard}>
                <span className={styles.tSummaryValue}>{fmtIkm(avgIkm)}</span>
                <span className={styles.tSummaryLabel}>Rata-rata IKM</span>
                <span className={`${styles.tQualityBadge} ${qualityClass(avgIkm)}`}>
                  {qualityText(avgIkm)}
                </span>
              </div>
              <div className={styles.tSummaryCard}>
                <span className={styles.tSummaryValue}>{totalResponden}</span>
                <span className={styles.tSummaryLabel}>Total Responden</span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 'var(--space-2)' }}>
                  Kuartal Ini
                </span>
              </div>
              <div className={styles.tSummaryCard}>
                <span className={styles.tSummaryValue}>{rows.length}</span>
                <span className={styles.tSummaryLabel}>Layanan Aktif</span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 'var(--space-2)' }}>
                  {scored.length} dengan data
                </span>
              </div>
            </div>

            <div className={styles.tChartCard}>
              <h2 className={styles.tChartTitle}>Grafik IKM per Layanan</h2>
              <div className={styles.tChartBody}>
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
                  <div className={styles.tChartEmpty}>
                    <BarChart3 size={28} style={{ marginRight: 8, verticalAlign: 'middle' }} />
                    Belum ada data IKM untuk kuartal ini
                  </div>
                )}
              </div>
            </div>

            <div className={styles.tTableSection}>
              <table className={styles.tTable}>
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
                      <td colSpan={4} className={styles.tTableEmpty}>
                        Belum ada data layanan
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => (
                      <tr key={r.layanan_id}>
                        <td style={{ fontWeight: 500 }}>{r.layanan_nama}</td>
                        <td><span className={styles.tIkmValue}>{fmtIkm(r.ikm)}</span></td>
                        <td>{r.responden}</td>
                        <td>
                          <span className={`${styles.tQualityBadge} ${qualityClass(r.ikm)}`}>
                            {qualityText(r.ikm)}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {lastUpdated && (
              <div className={styles.tFooter}>
                Diperbarui: {lastUpdated}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
