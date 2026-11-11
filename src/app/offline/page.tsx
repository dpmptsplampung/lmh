import { WifiOff, ArrowLeft } from 'lucide-react';
import Tombol from '@/components/ui/Tombol';
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
        {/* Halaman ini Server Component: komponen ikon tidak boleh dioper lewat prop `ikon` ke Tombol (client). */}
        <Tombol href="/" className={styles.tombolBesar}>
          <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" className={styles.ikonAwal} />
          Kembali ke Beranda
        </Tombol>
      </div>
    </div>
  );
}
