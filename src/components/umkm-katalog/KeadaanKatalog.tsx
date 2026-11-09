import Tombol from '@/components/ui/Tombol';
import { KatalogError } from './api';
import styles from './katalog.module.css';

export default function KeadaanKatalog({ error, onRetry }: { error: KatalogError; onRetry: () => void }) {
  return <div className={styles.keadaan} role={error.status === 503 ? 'status' : 'alert'}>
    <p>{error.message}</p>
    <Tombol varian="sekunder" onClick={onRetry}>Coba lagi</Tombol>
  </div>;
}
