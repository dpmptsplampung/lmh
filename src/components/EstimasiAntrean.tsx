'use client';

import { useEffect, useState, useCallback } from 'react';
import { Clock, Users, CheckCircle2, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import styles from './EstimasiAntrean.module.css';

export interface LoketEstimasi {
  layanan_id: string;
  layanan_nama: string;
  tipe: string;
  antre_count: number;
  dilayani_count: number;
  estimasi_durasi_menit: number;
  estimasi_tunggu_total_menit: number;
}

type WaitLevel = 'normal' | 'warning' | 'danger' | 'empty';

function waitLevel(row: LoketEstimasi): WaitLevel {
  if (row.antre_count === 0) return 'empty';
  if (row.estimasi_tunggu_total_menit > 60) return 'danger';
  if (row.estimasi_tunggu_total_menit > 30) return 'warning';
  return 'normal';
}

export default function EstimasiAntrean() {
  const [lokets, setLokets] = useState<LoketEstimasi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLokets = useCallback(async () => {
    const supabase = createClient();
    const { data, error: fetchError } = await supabase
      .from('v_antrian_loket')
      .select('*')
      .order('layanan_nama');

    if (fetchError) {
      setError('Gagal memuat estimasi antrean');
      return;
    }
    setError(null);
    setLokets((data ?? []) as LoketEstimasi[]);
  }, []);

  useEffect(() => {
    let channel: ReturnType<ReturnType<typeof createClient>['channel']> | null = null;

    (async () => {
      setLoading(true);
      await fetchLokets();
      setLoading(false);

      const supabase = createClient();
      channel = supabase
        .channel('visit_changes')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'visit' },
          () => { void fetchLokets(); },
        )
        .subscribe();
    })();

    return () => {
      if (channel) {
        void channel.unsubscribe();
      }
    };
  }, [fetchLokets]);

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <h2 className={styles.title}>
          <Clock size={20} />
          Estimasi Antrean Sekarang
        </h2>
        <p className={styles.subtitle}>
          Perkiraan waktu tunggu realtime berdasarkan riwayat layanan 14 hari terakhir.
        </p>
      </div>

      {loading && (
        <div className={styles.loading}>
          <Loader2 size={24} className={styles.spinner} />
          Memuat estimasi antrean…
        </div>
      )}

      {!loading && error && (
        <div className={styles.error}>{error}</div>
      )}

      {!loading && !error && lokets.length === 0 && (
        <div className={styles.empty}>
          Belum ada data antrean aktif. Silakan kembali lagi nanti.
        </div>
      )}

      {!loading && !error && lokets.length > 0 && (
        <div className={styles.grid}>
          {lokets.map((loket) => {
            const level = waitLevel(loket);
            return (
              <div key={loket.layanan_id} className={styles.card}>
                <div className={styles.cardHeader}>
                  <h3 className={styles.loketName}>{loket.layanan_nama}</h3>
                  <span
                    className={`${styles.badge} ${styles[`badge_${level}`]}`}
                    data-wait-level={level === 'empty' ? 'normal' : level}
                  >
                    {level === 'empty' ? (
                      <>
                        <CheckCircle2 size={14} />
                        Tidak ada antrean
                      </>
                    ) : (
                      <>
                        <Clock size={14} />
                        ~{loket.estimasi_tunggu_total_menit} menit
                      </>
                    )}
                  </span>
                </div>
                <div className={styles.cardBody}>
                  <span className={styles.metric}>
                    <Users size={16} />
                    {loket.antre_count} antre
                  </span>
                  {loket.dilayani_count > 0 && (
                    <span className={styles.metric}>
                      <Clock size={16} />
                      {loket.dilayani_count} dilayani
                    </span>
                  )}
                  <span className={styles.metricMeta}>
                    rata-rata {loket.estimasi_durasi_menit} menit/layanan
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
