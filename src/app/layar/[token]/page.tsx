'use client';

// WP-29 / DSP-01..07: Token-gated TV queue display.
// DSP-07: accessed via /layar/[token] — no login required.
// DSP-06/I-14: never displays nama or kontak_hp (reads v_layar_antrian).
// DSP-02: realtime updates via siaran antrean:publik + polling fallback.
// DSP-03: robust reconnection for days-long display.
// Audit T4: gangguan jaringan BUKAN token invalid — hanya jawaban RPC `false` yang eksplisit.
// Gangguan → "Menghubungkan ulang…", data terakhir dipertahankan, coba-ulang backoff eksponensial.

import { useEffect, useState, useCallback, use } from 'react';
import { Loader2, Monitor, Clock, Users, WifiOff } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getSiteSettings } from '@/lib/site-settings';
import { APP_NAME } from '@/lib/constants';
import { backoffMs, denganBatas } from '@/lib/layar/koneksi';
import { useAntreanFeed } from '@/lib/layar/useAntreanFeed';
import styles from './layar-token.module.css';

interface LoketStatus {
  layanan_id: string;
  layanan_nama: string;
  tipe: string;
  antre_count: number;
  dilayani_count: number;
  nomor_sedang_dilayani: number | null;
  // Format 'OS-014' (2 huruf + tanda hubung + 3 digit) — diperlakukan sebagai teks buram.
  nomor_display_dilayani: string | null;
  estimasi_durasi_menit: number;
  estimasi_tunggu_total_menit: number;
}

type StatusToken = 'memeriksa' | 'valid' | 'tidak_valid' | 'gangguan';

/** Kalimat untuk region live: nomor yang baru dipanggil sejak muat sebelumnya (bukan muat pertama). */
function susunPengumuman(sebelumnya: LoketStatus[] | null, berikutnya: LoketStatus[]): string {
  if (!sebelumnya) return '';
  const lama = new Map(sebelumnya.map(l => [l.layanan_id, l.nomor_display_dilayani]));
  return berikutnya
    .filter(l => l.nomor_display_dilayani && lama.get(l.layanan_id) !== l.nomor_display_dilayani)
    .map(l => `Nomor ${l.nomor_display_dilayani} dipanggil di ${l.layanan_nama}`)
    .join('. ');
}

export default function LayarTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);

  const [statusToken, setStatusToken] = useState<StatusToken>('memeriksa');
  const [clock, setClock]             = useState<Date | null>(null);
  const [runningText, setRunningText] = useState('');
  const [pengumuman, setPengumuman]   = useState('');

  // Validasi token. Hanya `data === false` (RPC menjawab eksplisit) yang berarti tidak valid;
  // error/jaringan/timeout/jawaban tak terduga = gangguan → coba lagi dengan backoff.
  useEffect(() => {
    let batal = false;
    let gagal = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cek = async () => {
      let hasil: StatusToken = 'gangguan';
      try {
        const supabase = createClient();
        const { data, error: rpcErr } = await denganBatas(
          supabase.rpc('validate_layar_token', { p_token: token }),
        );
        if (!rpcErr) {
          if (data === true) hasil = 'valid';
          else if (data === false) hasil = 'tidak_valid';
        }
      } catch {
        hasil = 'gangguan';
      }
      if (batal) return;
      setStatusToken(hasil);
      if (hasil === 'gangguan') {
        gagal += 1;
        timer = setTimeout(() => { void cek(); }, backoffMs(gagal));
      }
    };
    void cek();

    return () => {
      batal = true;
      if (timer) clearTimeout(timer);
    };
  }, [token]);

  // Load running text from site_settings (DSP-05)
  useEffect(() => {
    getSiteSettings(['running_text_layar']).then(s => {
      if (s.running_text_layar) setRunningText(String(s.running_text_layar));
    }).catch(() => {});
  }, []);

  const ambil = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('v_layar_antrian')
      .select('*')
      .order('layanan_nama');
    return { data: data as LoketStatus[] | null, error };
  }, []);

  const saatData = useCallback((sebelumnya: LoketStatus[] | null, berikutnya: LoketStatus[]) => {
    const kalimat = susunPengumuman(sebelumnya, berikutnya);
    if (kalimat) setPengumuman(kalimat);
  }, []);

  // Siaran realtime (debounce) + polling + backoff saat gangguan — lihat useAntreanFeed.
  const { data: lokets, updatedAt, reconnecting } = useAntreanFeed<LoketStatus>({
    aktif: statusToken === 'valid',
    ambil,
    saatData,
  });
  const siap = updatedAt !== null;

  // Clock tick
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // --- Render states ---

  if (statusToken === 'memeriksa') {
    return (
      <main className={styles.screen}>
        <div className={styles.center} role="status">
          <Loader2 size={40} className={styles.spinner} />
          Memverifikasi akses…
        </div>
      </main>
    );
  }

  if (statusToken === 'gangguan') {
    return (
      <main className={styles.screen}>
        <div className={styles.center} role="status">
          <WifiOff size={40} />
          <p>Menghubungkan ulang…</p>
          <p className={styles.centerCatatan}>
            Akses layar belum dapat diverifikasi karena gangguan koneksi. Mencoba lagi otomatis.
          </p>
        </div>
      </main>
    );
  }

  if (statusToken === 'tidak_valid') {
    return (
      <main className={styles.screen}>
        <div className={styles.center}>
          <WifiOff size={40} />
          <p>Token tidak valid atau sudah dicabut.</p>
          <p className={styles.centerCatatan}>
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
          <Monitor size={32} color="#38bdf8" aria-hidden="true" />
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

      {/* Region live untuk pembaca layar: nomor yang baru dipanggil (polite, tidak menyela) */}
      <div className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">
        {pengumuman}
      </div>

      {/* Gangguan setelah data pernah tampil: data terakhir tetap ditampilkan */}
      <div role="status" aria-live="polite">
        {siap && reconnecting && (
          <div className={styles.reconnectBar}>
            <WifiOff size={24} aria-hidden="true" />
            Menghubungkan ulang… menampilkan data terakhir
          </div>
        )}
      </div>

      {/* Running text banner (DSP-05) */}
      {runningText && (
        <div className={styles.runningTextBar} aria-live="off">
          <span className={styles.runningText}>{runningText}</span>
        </div>
      )}

      {/* Body */}
      {!siap && !reconnecting && (
        <div className={styles.center} role="status">
          <Loader2 size={32} className={styles.spinner} />
          Memuat status antrean…
        </div>
      )}

      {!siap && reconnecting && (
        <div className={styles.center} role="status">
          <WifiOff size={32} />
          Menghubungkan ulang…
        </div>
      )}

      {siap && (
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
                      <Users size={20} aria-hidden="true" /> Tidak ada antrean — silakan langsung ke loket
                    </span>
                  ) : (
                    <span className={styles.footerWait}>
                      <Clock size={20} aria-hidden="true" /> Estimasi tunggu ±{Math.round(loket.estimasi_tunggu_total_menit)} menit
                    </span>
                  )}
                </div>
              </section>
            );
          })}

          {lokets.length === 0 && (
            <div className={styles.kosongSemua}>
              <Monitor size={48} className={styles.kosongIkon} aria-hidden="true" />
              <p>Belum ada layanan aktif hari ini.</p>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.updatedIndicator}>
          <div className={`${styles.updatedDot} ${reconnecting ? styles.updatedDotGangguan : ''}`} />
          <span suppressHydrationWarning>
            {updatedAt
              ? `${reconnecting ? 'Data terakhir' : 'Diperbarui'} ${updatedAt.toLocaleTimeString('id-ID')}`
              : 'Menghubungkan…'}
          </span>
        </div>
        <span>Silakan menuju loket layanan sesuai keperluan Anda</span>
      </footer>
    </main>
  );
}
