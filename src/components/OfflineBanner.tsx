'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CloudUpload, WifiOff, X } from 'lucide-react';
import { teksAntreanOffline, useAntreanOffline } from '@/lib/hooks/useAntreanOffline';
import styles from './OfflineBanner.module.css';

const SESSION_KEY = 'lmh-offline-banner-dismissed';
/** Tinggi banner yang sedang tampil; bilah atas dan sidebar admin (fixed) bergeser sebesar ini agar tidak tertutup. */
export const VAR_TINGGI_BANNER = '--tinggi-banner-offline';

export default function OfflineBanner() {
  const [online, setOnline] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  // A10: jumlah pendaftaran offline milik akun yang menunggu dikirim, dan "Terkirim" sesudah replay.
  const { jumlah, terkirim } = useAntreanOffline();
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);
    try {
      setDismissed(sessionStorage.getItem(SESSION_KEY) === '1');
    } catch {
      setDismissed(false);
    }

    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
      // sessionStorage may be unavailable (private mode) — non-fatal
    }
  };

  const teksAntrean = teksAntreanOffline(jumlah);
  const tampil = (!online && !dismissed) ? 'offline' : teksAntrean ? 'antrean' : terkirim ? 'terkirim' : null;

  // Banner sticky di atas halaman; elemen fixed (AppBar, sidebar admin) membaca tinggi ini lewat variabel CSS.
  useEffect(() => {
    const node = raiz.current;
    const root = document.documentElement;
    if (!tampil || !node) {
      root.style.removeProperty(VAR_TINGGI_BANNER);
      return;
    }
    const tulis = () => root.style.setProperty(VAR_TINGGI_BANNER, `${node.offsetHeight}px`);
    tulis();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(tulis);
    ro?.observe(node);
    return () => {
      ro?.disconnect();
      root.style.removeProperty(VAR_TINGGI_BANNER);
    };
  }, [tampil]);

  if (tampil === 'offline') {
    return (
      <div ref={raiz} className={styles.banner} role="status" aria-live="polite">
        <div className={styles.content}>
          <WifiOff size={18} className={styles.icon} aria-hidden="true" />
          <span className={styles.text}>
            Anda sedang offline. Beberapa fitur mungkin tidak tersedia. Perubahan
            Anda akan disinkronkan saat online kembali.
            {teksAntrean && <strong className={styles.hitung}> {teksAntrean}.</strong>}
          </span>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={handleDismiss}
            aria-label="Tutup pemberitahuan offline"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    );
  }

  // Sudah online: tetap beri tahu FO bahwa pendaftarannya belum hilang (menunggu dikirim) atau sudah terkirim.
  if (tampil === 'antrean') {
    return (
      <div ref={raiz} className={styles.bannerInfo} role="status" aria-live="polite">
        <div className={styles.content}>
          <CloudUpload size={18} className={styles.iconInfo} aria-hidden="true" />
          <span className={styles.text}>{teksAntrean}.</span>
        </div>
      </div>
    );
  }
  if (tampil === 'terkirim') {
    return (
      <div ref={raiz} className={styles.bannerOk} role="status" aria-live="polite">
        <div className={styles.content}>
          <CheckCircle2 size={18} className={styles.iconOk} aria-hidden="true" />
          <span className={styles.text}>Terkirim. Pendaftaran offline sudah masuk ke sistem.</span>
        </div>
      </div>
    );
  }
  return null;
}
