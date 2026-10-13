'use client';

import { AlertCircle, RefreshCw } from 'lucide-react';
import styles from './ErrorRetry.module.css';

interface ErrorRetryProps {
  /** Pesan kegagalan yang jelas untuk pengguna (bukan keadaan kosong palsu). */
  pesan: string;
  /** Judul singkat opsional di atas pesan. */
  judul?: string;
  /** Dipanggil saat tombol ditekan; tanpa ini tombol tidak ditampilkan. */
  onRetry?: () => void;
  /**
   * True saat percobaan ulang sedang berjalan: tombol dinonaktifkan dan label berubah ke "Memuat…".
   * (Idealnya `aria-disabled` + label tetap agar fokus papan ketik tidak hilang, tetapi test pemakai
   * di src/app/chat/page.error.test.tsx mengunci perilaku `disabled` + nama "Memuat…".)
   */
  memuat?: boolean;
  labelTombol?: string;
}

// Pengganti keadaan "kosong"/"sukses" palsu saat pemuatan data gagal (audit T6, T7, S14):
// pesan jelas + tombol "Coba lagi". role="alert" agar pembaca layar langsung membacakannya.
// aria-atomic="false" meniadakan bawaan role=alert (atomic=true) supaya perubahan label tombol saat
// memuat hanya mengumumkan teks yang berubah, bukan membacakan ulang seluruh pesan galat.
export default function ErrorRetry({
  pesan,
  judul,
  onRetry,
  memuat = false,
  labelTombol = 'Coba lagi',
}: ErrorRetryProps) {
  return (
    <div className={styles.wadah} role="alert" aria-atomic="false">
      <AlertCircle size={20} className={styles.ikon} aria-hidden="true" />
      <div className={styles.isi}>
        {judul && <p className={styles.judul}>{judul}</p>}
        <p className={styles.pesan}>{pesan}</p>
        {onRetry && (
          <button
            type="button"
            className={`btn btn--secondary ${styles.tombol}`}
            onClick={memuat ? undefined : onRetry}
            disabled={memuat}
            aria-busy={memuat || undefined}
          >
            <RefreshCw size={16} aria-hidden="true" className={memuat ? styles.berputar : undefined} />
            {memuat ? 'Memuat…' : labelTombol}
          </button>
        )}
      </div>
    </div>
  );
}
