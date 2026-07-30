'use client';

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Users, Clock, MonitorPlay } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { APP_NAME } from '@/lib/constants';
import type { LoketEstimasi } from '@/components/EstimasiAntrean';
import styles from './layar-antrian.module.css';

export default function LayarAntrianPage() {
  const [lokets, setLokets] = useState<LoketEstimasi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [clock, setClock] = useState<Date | null>(null);

  const fetchLokets = useCallback(async () => {
    const supabase = createClient();
    const { data, error: fetchError } = await supabase
      .from('v_antrian_loket')
      .select('*')
      .order('layanan_nama');
    if (fetchError) {
      setError(true);
      return;
    }
    setError(false);
    setLokets((data ?? []) as LoketEstimasi[]);
    setUpdatedAt(new Date());
  }, []);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    const channel = supabase
      // WP-22: subscribe to tiket_antrean changes; v_antrian_loket now reads from it.
      // visit writes still propagate via trg_visit_dual_write, so either table works.
      .channel('layar_antrian_tiket_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tiket_antrean' },
        () => { void fetchLokets(); },
      );

    (async () => {
      setLoading(true);
      await fetchLokets();
      if (!cancelled) setLoading(false);
      channel.subscribe();
    })();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [fetchLokets]);

  // Big clock for the lobby display
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <MonitorPlay size={30} />
          <div>
            <h1 className={styles.title}>Status Antrean Layanan</h1>
            <p className={styles.subtitle}>{APP_NAME} — diperbarui realtime</p>
          </div>
        </div>
        {clock && (
          <div className={styles.clock} suppressHydrationWarning>
            {clock.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            <span className={styles.clockDate}>
              {clock.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          </div>
        )}
      </header>

      {loading && (
        <div className={styles.center}>
          <Loader2 size={32} className={styles.spinner} />
          Memuat status antrean…
        </div>
      )}

      {!loading && error && (
        <div className={styles.center}>
          Gagal memuat data antrean. Menampilkan ulang otomatis saat koneksi pulih.
        </div>
      )}

      {!loading && !error && (
        <div className={styles.grid}>
          {lokets.map((loket) => {
            const kosong = loket.antre_count === 0 && loket.dilayani_count === 0;
            return (
              <section
                key={loket.layanan_id}
                className={`${styles.loket} ${kosong ? styles.loketKosong : ''}`}
              >
                <h2 className={styles.loketName}>{loket.layanan_nama}</h2>

                <div className={styles.loketBody}>
                  <div className={styles.stat}>
                    <span className={styles.statValue}>{loket.dilayani_count}</span>
                    <span className={styles.statLabel}>sedang dilayani</span>
                  </div>
                  <div className={styles.statDivider} />
                  <div className={styles.stat}>
                    <span className={styles.statValue}>{loket.antre_count}</span>
                    <span className={styles.statLabel}>sisa antrean</span>
                  </div>
                </div>

                <div className={styles.loketFooter}>
                  {kosong ? (
                    <span className={styles.footerOk}>
                      <Users size={15} /> Tidak ada antrean — silakan langsung ke loket
                    </span>
                  ) : (
                    <span className={styles.footerWait}>
                      <Clock size={15} /> Estimasi tunggu ±{loket.estimasi_tunggu_total_menit} menit
                    </span>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <footer className={styles.footer}>
        {updatedAt && (
          <span suppressHydrationWarning>
            Data terakhir diperbarui {updatedAt.toLocaleTimeString('id-ID')}
          </span>
        )}
        <span>Silakan menuju loket layanan sesuai keperluan Anda</span>
      </footer>
    </main>
  );
}
