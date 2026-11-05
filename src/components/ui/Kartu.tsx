import { useId, type ElementType, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import styles from './Kartu.module.css';

export interface KartuProps {
  judul?: ReactNode;
  /** Slot kanan kepala kartu (mis. MenuTitikTiga atau Tombol kecil). */
  aksi?: ReactNode;
  padding?: 'normal' | 'rapat' | 'tanpa';
  /** Elemen pembungkus. Bawaan `section`; dengan `judul` dihubungkan lewat aria-labelledby. */
  as?: 'section' | 'div' | 'article' | 'li';
  className?: string;
  id?: string;
  children?: ReactNode;
}

// Kartu putih datar (radius 16, bayangan tipis). Padding `tanpa` untuk isi yang menempel ke tepi (tabel).
export default function Kartu({ judul, aksi, padding = 'normal', as = 'section', className, id, children }: KartuProps) {
  const idJudul = useId();
  const Elemen: ElementType = as;
  const adaKepala = judul !== undefined && judul !== null && judul !== false;
  return (
    <Elemen
      id={id}
      className={cn(styles.kartu, styles[padding], className)}
      aria-labelledby={adaKepala ? idJudul : undefined}
    >
      {(adaKepala || aksi) && (
        <header className={cn(styles.kepala, padding === 'tanpa' && styles.kepalaTanpa)}>
          {adaKepala ? (
            <h2 id={idJudul} className={styles.judul}>
              {judul}
            </h2>
          ) : (
            <span />
          )}
          {aksi && <div className={styles.aksi}>{aksi}</div>}
        </header>
      )}
      {children}
    </Elemen>
  );
}
