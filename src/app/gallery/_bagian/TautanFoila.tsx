import { ExternalLink } from 'lucide-react';
import { HOST_FOILA } from '@/lib/investasi/konstanta';
import styles from '../gallery.module.css';

/** Pengganti kotak "Portal FOILA": cukup satu baris tautan. */
export default function TautanFoila() {
  return (
    <p className={styles.foila}>
      Mencari proyek lain?{' '}
      <a href={`https://${HOST_FOILA}/`} target="_blank" rel="noopener noreferrer external">
        Kunjungi portal FOILA <ExternalLink size={14} aria-hidden="true" />
        <span className="sr-only"> (membuka situs FOILA di tab baru)</span>
      </a>
    </p>
  );
}
