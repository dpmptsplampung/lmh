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
  ClipboardList,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import styles from './skm.module.css';

const CHART_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

interface LayananRow {
  id: string;
  nama: string;
  tipe: string | null;
}

interface IkmRow {
  layanan_id: string;
  layanan_nama: string;
  ikm: number | null;
  responden: number;
}

type Period = 'month' | 'quarter' | 'year';

function getDateRange(period: Period): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString().split('T')[0];
  let start: Date;
  if (period === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (period === 'quarter') {
    const qMonth = Math.floor(now.getMonth() / 3) * 3;
    start = new Date(now.getFullYear(), qMonth, 1);
  } else {
    start = new Date(now.getFullYear(), 0, 1);
  }
  return { start: start.toISOString().split('T')[0], end };
}

function qualityLabel(ikm: number | null): { grade: 'A' | 'B' | 'C' | 'D' | '-'; text: string; cls: string } {
  if (ikm === null || Number.isNaN(ikm)) {
    return { grade: '-', text: 'N/A', cls: styles.qualityD };
  }
  if (ikm >= 88) return { grade: 'A', text: 'Sangat Baik', cls: styles.qualityA };
  if (ikm >= 76) return { grade: 'B', text: 'Baik', cls: styles.qualityB };
  if (ikm >= 60) return { grade: 'C', text: 'Kurang Baik', cls: styles.qualityC };
  return { grade: 'D', text: 'Tidak Baik', cls: styles.qualityD };
}

function fmtIkm(v: number | null): string {
  if (v === null || Number.isNaN(v)) return '—';
  return v.toFixed(1);
}

export default function SkmAdminPage() {
  const [period, setPeriod] = useState<Period>('month');
  const [rows, setRows] = useState<IkmRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const supabase = createClient();
      const { data: layananRaw, error: layananErr } = await supabase
        .from('layanan')
        .select('id, nama, tipe')
        .neq('tipe', 'modul_publik')
        .order('nama');

      if (layananErr) throw layananErr;
      const layananList = (layananRaw ?? []) as LayananRow[];

      const { start, end } = getDateRange(period);

      const results = await Promise.all(
        layananList.map(async (l) => {
          const { data, error: rpcErr } = await supabase.rpc('hitung_ikm', {
            p_layanan_id: l.id,
            p_start: start,
            p_end: end,
          });
          if (rpcErr) {
            return {
              layanan_id: l.id,
              layanan_nama: l.nama,
              ikm: null,
              responden: 0,
            } as IkmRow;
          }
          const arr = (data ?? []) as Array<{ layanan_id: string; layanan_nama: string; ikm: number | null; responden: number }>;
          if (arr.length === 0) {
            return {
              layanan_id: l.id,
              layanan_nama: l.nama,
              ikm: null,
              responden: 0,
            } as IkmRow;
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
    } catch (e) {
      console.error('SKM dashboard error:', e);
      setError('Gagal memuat data IKM. Pastikan Anda login sebagai admin/petugas.');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  const totalResponden = rows.reduce((s, r) => s + r.responden, 0);
  const scored = rows.filter((r) => r.ikm !== null);
  const avgIkm = scored.length > 0
    ? scored.reduce((s, r) => s + (r.ikm as number), 0) / scored.length
    : null;
  const avgQuality = qualityLabel(avgIkm);

  const chartData = rows
    .filter((r) => r.ikm !== null)
    .map((r) => ({ nama: r.layanan_nama, ikm: Number((r.ikm as number).toFixed(1)) }));

  const periodLabel = period === 'month' ? 'Bulan Ini' : period === 'quarter' ? 'Kuartal Ini' : 'Tahun Ini';

  return (
    <>
      <PageHeader
        title="Dashboard SKM"
        description="Indeks Kepuasan Masyarakat (PermenPANRB 14/2017) per layanan"
      />

      <div className={styles.skmContainer}>
        <div className={styles.skmHeader}>
          <div>
            <h2 className={styles.skmTitle}>IKM per Layanan</h2>
            <p className={styles.skmSubtitle}>
              {periodLabel} — 9 unsur kepuasan, skala 25-100
            </p>
          </div>
          <Link href="/admin" className={styles.skmBackLink}>
            <ArrowLeft size={16} />
            Kembali ke Dashboard
          </Link>
        </div>

        {error && (
          <div className={styles.errorBox} role="alert">
            <AlertCircle size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            {error}
          </div>
        )}

        <div className={styles.filterBar}>
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Periode</span>
            <select
              className={styles.filterSelect}
              value={period}
              onChange={(e) => setPeriod(e.target.value as Period)}
              aria-label="Pilih periode"
            >
              <option value="month">Bulan Ini</option>
              <option value="quarter">Kuartal Ini</option>
              <option value="year">Tahun Ini</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className={styles.loading}>
            <Loader2 size={28} className="animate-pulse" />
          </div>
        ) : (
          <>
            <div className={styles.summaryGrid}>
              <div className={styles.summaryCard}>
                <span className={styles.summaryLabel}>Rata-rata IKM</span>
                <span className={styles.summaryValue}>{fmtIkm(avgIkm)}</span>
                <span className={`${styles.qualityBadge} ${avgQuality.cls}`}>
                  {avgQuality.grade} — {avgQuality.text}
                </span>
              </div>
              <div className={styles.summaryCard}>
                <span className={styles.summaryLabel}>Total Responden</span>
                <span className={styles.summaryValue}>{totalResponden}</span>
                <span className={styles.summaryLabel}>{periodLabel}</span>
              </div>
              <div className={styles.summaryCard}>
                <span className={styles.summaryLabel}>Layanan Disurvei</span>
                <span className={styles.summaryValue}>{rows.length}</span>
                <span className={styles.summaryLabel}>{scored.length} dengan data</span>
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
                    Belum ada data IKM untuk periode ini
                  </div>
                )}
              </div>
            </div>

            <div className={styles.tableSection}>
              <h3 className={styles.tableTitle}>Tabel IKM per Layanan</h3>
              <div className={styles.tableWrapper}>
                <table className={styles.skmTable}>
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
                      rows.map((r) => {
                        const q = qualityLabel(r.ikm);
                        return (
                          <tr key={r.layanan_id}>
                            <td style={{ fontWeight: 500 }}>{r.layanan_nama}</td>
                            <td><span className={styles.ikmValue}>{fmtIkm(r.ikm)}</span></td>
                            <td>{r.responden}</td>
                            <td>
                              <span className={`${styles.qualityBadge} ${q.cls}`}>
                                {q.grade} — {q.text}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
