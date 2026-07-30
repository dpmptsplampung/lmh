'use client';

// WP-29 / DSP-01..07: Token-gated TV queue display.
// DSP-07: accessed via /layar/[token] — no login required.
// DSP-06/I-14: never displays nama or kontak_hp (reads v_layar_antrian).
// DSP-02: realtime updates via tiket_antrean subscription + polling fallback.
// DSP-03: robust reconnection for days-long display.

import { useEffect, useState, useCallback, use } from 'react';
import { Loader2, Monitor, Clock, Users, WifiOff } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getSiteSettings } from '@/lib/site-settings';
import { APP_NAME } from '@/lib/constants';
import styles from './layar-token.module.css';

interface LoketStatus {
  layanan_id: string;
  layanan_nama: string;
  tipe: string;
  antre_count: number;
  dilayani_count: number;
  nomor_sedang_dilayani: number | null;
  nomor_display_dilayani: string | null;
  estimasi_durasi_menit: number;
  estimasi_tunggu_total_menit: number;
}

export default function LayarTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);

  const [valid, setValid]           = useState<boolean | null>(null);
  const [lokets, setLokets]         = useState<LoketStatus[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(false);
  const [updatedAt, setUpdatedAt]   = useState<Date | null>(null);
  const [clock, setClock]           = useState<Date | null>(null);
  const [runningText, setRunningText] = useState('');

  // Validate token on mount
  useEffect(() => {
    async function validateToken() {
      const supabase = createClient();
      const { data, error: rpcErr } = await supabase.rpc('validate_layar_token', { p_token: token });
      if (rpcErr || data === false) {
        setValid(false);
      } else {
        setValid(true);
      }
    }
    validateToken();
  }, [token]);

  // Load running text from site_settings (DSP-05)
  useEffect(() => {
    getSiteSettings(['running_text_layar']).then(s => {
      if (s.running_text_layar) setRunningText(String(s.running_text_layar));
    }).catch(() => {});
  }, []);

  // Fetch queue data
  const fetchData = useCallback(async () => {
    const supabase = createClient();
    const { data, error: fetchErr } = await supabase
      .from('v_layar_antrian')
      .select('*')
      .order('layanan_nama');
    if (fetchErr) {
      setError(true);
      return;
    }
    setError(false);
    setLokets((data ?? []) as LoketStatus[]);
    setUpdatedAt(new Date());
  }, []);

  // Subscribe to tiket_antrean changes + polling fallback (DSP-02/03)
  useEffect(() => {
    if (valid !== true) return;

    let cancelled = false;
    const supabase = createClient();

    const channel = supabase
      .channel('layar_token_' + token)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tiket_antrean' },
        () => { void fetchData(); })
      .subscribe();

    // Initial load
    (async () => {
      setLoading(true);
      await fetchData();
      if (!cancelled) setLoading(false);
    })();

    // Polling fallback every 30s (DSP-03)
    const poll = setInterval(() => { void fetchData(); }, 30_000);

    return () => {
      cancelled = true;
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [valid, token, fetchData]);

  // Clock tick
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // --- Render states ---

  if (valid === null) {
    return (
      <main className={styles.screen}>
        <div className={styles.center}>
          <Loader2 size={40} className={styles.spinner} />
          Memverifikasi akses…
        </div>
      </main>
    );
  }

  if (valid === false) {
    return (
      <main className={styles.screen}>
        <div className={styles.center}>
          <WifiOff size={40} />
          <p>Token tidak valid atau sudah dicabut.</p>
          <p style={{ fontSize: '0.875rem', color: '#475569' }}>
            Hubungi Admin untuk mendapatkan URL layar yang baru.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.screen}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.brand}>
          <Monitor size={32} color="#38bdf8" />
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

      {/* Running text banner (DSP-05) */}
      {runningText && (
        <div className={styles.runningTextBar} aria-live="off">
          <span className={styles.runningText}>{runningText}</span>
        </div>
      )}

      {/* Body */}
      {loading && (
        <div className={styles.center}>
          <Loader2 size={32} className={styles.spinner} />
          Memuat status antrean…
        </div>
      )}

      {!loading && error && (
        <div className={styles.center}>
          <WifiOff size={32} />
          Gagal memuat data. Mencoba ulang otomatis…
        </div>
      )}

      {!loading && !error && (
        <div className={styles.grid}>
          {lokets.map(loket => {
            const kosong = loket.antre_count === 0 && loket.dilayani_count === 0;
            return (
              <section
                key={loket.layanan_id}
                className={`${styles.loket} ${kosong ? styles.loketKosong : ''}`}
                aria-label={loket.layanan_nama}
              >
                <h2 className={styles.loketName}>{loket.layanan_nama}</h2>

                {/* Nomor sedang dilayani */}
                {loket.nomor_display_dilayani && (
                  <div className={styles.nomorDilayani}>
                    Melayani
                    <span className={styles.nomorDilayaniValue}>
                      {loket.nomor_display_dilayani}
                    </span>
                  </div>
                )}

                <div className={styles.loketBody}>
                  {/* Sedang dilayani */}
                  <div className={styles.stat}>
                    <span className={`${styles.statValue} ${loket.dilayani_count === 0 ? styles.statValueZero : styles.statValueActive}`}>
                      {loket.dilayani_count}
                    </span>
                    <span className={styles.statLabel}>sedang dilayani</span>
                  </div>

                  <div className={styles.statDivider} />

                  {/* Sisa antrean */}
                  <div className={styles.stat}>
                    <span className={`${styles.statValue} ${loket.antre_count === 0 ? styles.statValueZero : ''}`}>
                      {loket.antre_count}
                    </span>
                    <span className={styles.statLabel}>sisa antrean</span>
                  </div>
                </div>

                <div className={styles.loketFooter}>
                  {kosong ? (
                    <span className={styles.footerOk}>
                      <Users size={14} /> Tidak ada antrean — silakan langsung ke loket
                    </span>
                  ) : (
                    <span className={styles.footerWait}>
                      <Clock size={14} /> Estimasi tunggu ±{Math.round(loket.estimasi_tunggu_total_menit)} menit
                    </span>
                  )}
                </div>
              </section>
            );
          })}

          {lokets.length === 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#475569', padding: '48px' }}>
              <Monitor size={48} style={{ marginBottom: 16, opacity: 0.4 }} />
              <p>Belum ada layanan aktif hari ini.</p>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.updatedIndicator}>
          <div className={styles.updatedDot} />
          <span suppressHydrationWarning>
            {updatedAt
              ? `Diperbarui ${updatedAt.toLocaleTimeString('id-ID')}`
              : 'Menghubungkan…'}
          </span>
        </div>
        <span>Silakan menuju loket layanan sesuai keperluan Anda</span>
      </footer>
    </main>
  );
}