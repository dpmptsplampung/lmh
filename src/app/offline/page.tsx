import Link from 'next/link';
import { WifiOff, ArrowLeft } from 'lucide-react';
import styles from './offline.module.css';

export const metadata = {
  title: 'Offline',
};

export default function OfflinePage() {
  return (
    <div className={styles.offlinePage}>
      <div className={styles.offlineCard}>
        <div className={styles.offlineIcon}>
          <WifiOff size={48} />
        </div>
        <h1 className={styles.offlineTitle}>Anda Sedang Offline</h1>
        <p className={styles.offlineDesc}>
          Koneksi internet tidak tersedia. Beberapa fitur mungkin tidak dapat
          diakses. Perubahan Anda akan disinkronkan saat online kembali.
        </p>
        <Link href="/" className="btn btn--primary btn--lg">
          <ArrowLeft size={20} />
          Kembali ke Beranda
        </Link>
      </div>
    </div>
  );
}
