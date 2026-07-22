'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import IkmPanel from '@/components/IkmPanel';
import type { IkmRow } from '@/lib/ikm';
import styles from './transparansi.module.css';

interface LayananRow {
  id: string;
  nama: string;
}

function currentQuarterRange(): { start: string; end: string } {
  const now = new Date();
  const qMonth = Math.floor(now.getMonth() / 3) * 3;
  const start = new Date(now.getFullYear(), qMonth, 1);
  const end = now.toISOString().split('T')[0];
  return { start: start.toISOString().split('T')[0], end };
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
            <IkmPanel rows={rows} periodLabel="Kuartal Ini" mode="public" />

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
