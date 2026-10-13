'use client';

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Users, Clock, MonitorPlay, WifiOff } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { APP_NAME } from '@/lib/constants';
import { useAntreanFeed } from '@/lib/layar/useAntreanFeed';
import type { LoketEstimasi } from '@/components/EstimasiAntrean';
import styles from './layar-antrian.module.css';

export default function LayarAntrianPage() {
  const [clock, setClock] = useState<Date | null>(null);

  const ambil = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('v_antrian_loket')
      .select('*')
      .order('layanan_nama');
    return { data: data as LoketEstimasi[] | null, error };
  }, []);

  // Audit T4: siaran realtime (debounce) + polling + backoff saat gangguan; data terakhir
  // tidak dihapus ketika koneksi putus (lihat useAntreanFeed).
  const { data: lokets, updatedAt, reconnecting } = useAntreanFeed<LoketEstimasi>({
    aktif: true,
    ambil,
  });
  const siap = updatedAt !== null;

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

      {/* Gangguan setelah data pernah tampil: data terakhir tetap ditampilkan */}
      <div role="status" aria-live="polite">
        {siap && reconnecting && (
          <div className={styles.reconnectBar}>
            <WifiOff size={22} aria-hidden="true" />
            Menghubungkan ulang… menampilkan data terakhir
          </div>
        )}
      </div>

      {!siap && !reconnecting && (
        <div className={styles.center} role="status">
          <Loader2 size={32} className={styles.spinner} />
          Memuat status antrean…
        </div>
      )}

      {!siap && reconnecting && (
        <div className={styles.center} role="status">
          Gagal memuat data antrean. Menampilkan ulang otomatis saat koneksi pulih.
        </div>
      )}

      {siap && (
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
