import { CircleAlert } from 'lucide-react';
import Tombol from '@/components/ui/Tombol';
import { KatalogError } from './api';
import styles from './publik.module.css';

export default function KeadaanKatalog({ error, onRetry }: { error: KatalogError; onRetry: () => void }) {
  return <div className={`${styles.panel} ${styles.panelGalat}`} role={error.status === 503 ? 'status' : 'alert'}>
    <CircleAlert size={24} aria-hidden="true" className={styles.panelIkon} />
    <p>{error.message}</p>
    <Tombol varian="sekunder" onClick={onRetry}>Coba lagi</Tombol>
  </div>;
}
