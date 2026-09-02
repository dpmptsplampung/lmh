'use client';

import { useEffect, useState, useCallback } from 'react';
import { Clock, Users, CheckCircle2, Loader2, CalendarOff, DoorClosed } from 'lucide-react';
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
  /** Present when view/API exposes history sample size; 0 or missing → provisional */
  sample_count?: number | null;
}

/** Tanggal hari ini menurut zona waktu kantor (WIB) dalam format YYYY-MM-DD —
 *  seluruh logika jadwal & hari_libur memakai Asia/Jakarta. */
function tanggalWIB(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

function isProvisional(row: LoketEstimasi): boolean {
  // View may not expose sample_count; default duration 15 with no history is provisional.
  // Treat explicit 0 as provisional; missing sample_count also treated as provisional
  // so we never claim "14-day history accuracy" without evidence.
  if (row.sample_count != null) return row.sample_count === 0;
  return true;
}

type WaitLevel = 'normal' | 'warning' | 'danger' | 'empty' | 'tutup';

function waitLevel(row: LoketEstimasi, tutup: boolean): WaitLevel {
  if (tutup) return 'tutup';
  if (row.antre_count === 0) return 'empty';
  if (row.estimasi_tunggu_total_menit > 60) return 'danger';
  if (row.estimasi_tunggu_total_menit > 30) return 'warning';
  return 'normal';
}

export default function EstimasiAntrean() {
  const [lokets, setLokets] = useState<LoketEstimasi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Keterangan hari libur nasional (dari tabel hari_libur) jika hari ini libur. */
  const [liburHariIni, setLiburHariIni] = useState<string | null>(null);
  /** layanan_id yang tutup hari ini menurut is_layanan_buka_jadwal(). */
  const [tutupIds, setTutupIds] = useState<Set<string>>(new Set());

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
    const rows = (data ?? []) as LoketEstimasi[];
    setLokets(rows);

    // --- Status buka/tutup hari ini (WIB) ---
    const today = tanggalWIB();
    // 1. Hari libur nasional (tabel hari_libur) → banner untuk seluruh section.
    const { data: liburRows } = await supabase
      .from('hari_libur')
      .select('keterangan')
      .eq('tanggal', today)
      .limit(1);
    setLiburHariIni(Array.isArray(liburRows) && liburRows.length > 0 ? liburRows[0].keterangan : null);

    // 2. Status per layanan via fungsi jadwal (pengecualian menang atas pola mingguan).
    //    Gagal cek tutup tidak boleh memblokir tampilan antrean — anggap buka.
    try {
      const results = await Promise.all(
        rows.map((row) =>
          supabase.rpc('is_layanan_buka_jadwal', {
            p_layanan_id: row.layanan_id,
            p_tanggal: today,
            p_jam: null,
          }),
        ),
      );
      const tutup = new Set(
        rows.filter((_, i) => results[i].data === false).map((row) => row.layanan_id),
      );
      setTutupIds(tutup);
    } catch {
      setTutupIds(new Set());
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // ponytail: realtime-js dedupes .channel() by topic and returns the EXISTING
    // channel — so cleanup must removeChannel() (drops it from the registry),
    // not unsubscribe() (leaves it registered; next mount gets it back and .on() throws)
    const supabase = createClient();
    const channel = supabase
      .channel('visit_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'visit' },
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

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <h2 className={styles.title}>
          <Clock size={20} />
          Estimasi Antrean Sekarang
        </h2>
        <p className={styles.subtitle}>
          Perkiraan waktu tunggu realtime. Jika belum ada data histori durasi, angka ditandai sebagai perkiraan sementara.
        </p>
      </div>

      {!loading && liburHariIni && (
        <div className={styles.holidayBanner} role="status">
          <CalendarOff size={18} />
          <span>
            Hari ini <strong>libur ({liburHariIni})</strong>. Layanan loket tutup — silakan berkunjung pada hari kerja berikutnya.
          </span>
        </div>
      )}

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
            const tutup = tutupIds.has(loket.layanan_id);
            const level = waitLevel(loket, tutup);
            return (
              <div key={loket.layanan_id} className={styles.card} data-tutup={tutup || undefined}>
                <div className={styles.cardHeader}>
                  <h3 className={styles.loketName}>{loket.layanan_nama}</h3>
                  <span
                    className={`${styles.badge} ${styles[`badge_${level}`]}`}
                    data-wait-level={level === 'empty' ? 'normal' : level}
                  >
                    {level === 'tutup' ? (
                      <>
                        <DoorClosed size={14} />
                        Tutup hari ini
                      </>
                    ) : level === 'empty' ? (
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
                    {isProvisional(loket)
                      ? `perkiraan sementara · default ${loket.estimasi_durasi_menit} menit/layanan (belum ada data histori)`
                      : `rata-rata ${loket.estimasi_durasi_menit} menit/layanan`}
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
