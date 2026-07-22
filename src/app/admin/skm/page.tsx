'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import IkmPanel from '@/components/IkmPanel';
import type { IkmRow } from '@/lib/ikm';
import styles from './skm.module.css';

interface LayananRow {
  id: string;
  nama: string;
  tipe: string | null;
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
      setError('Gagal memuat data IKM. Pastikan Anda masuk sebagai admin/petugas.');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

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
          <IkmPanel rows={rows} periodLabel={periodLabel} mode="admin" />
        )}
      </div>
    </>
  );
}
