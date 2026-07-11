'use client';

import { useEffect, useState } from 'react';
import { WifiOff, X } from 'lucide-react';
import styles from './OfflineBanner.module.css';

const SESSION_KEY = 'lmh-offline-banner-dismissed';

export default function OfflineBanner() {
  const [online, setOnline] = useState(true);
  const [dismissed, setDismissed] = useState(false);

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

  if (online || dismissed) return null;

  return (
    <div className={styles.banner} role="status" aria-live="polite">
      <div className={styles.content}>
        <WifiOff size={18} className={styles.icon} aria-hidden="true" />
        <span className={styles.text}>
          Anda sedang offline. Beberapa fitur mungkin tidak tersedia. Perubahan
          Anda akan disinkronkan saat online kembali.
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
