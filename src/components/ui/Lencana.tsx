import type { ElementType, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import styles from './Lencana.module.css';

export type NadaLencana = 'netral' | 'sukses' | 'peringatan' | 'bahaya' | 'info' | 'primer';

export interface LencanaProps {
  nada?: NadaLencana;
  /** Komponen ikon (mis. ikon lucide), digambar 14px dan disembunyikan dari pembaca layar. */
  ikon?: ElementType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean | 'true' }>;
  /** Titik berwarna di depan teks (alternatif ikon). */
  titik?: boolean;
  className?: string;
  children: ReactNode;
}

// Pil status. Makna selalu dibawa teks (children), warna hanya penguat.
export default function Lencana({ nada = 'netral', ikon: Ikon, titik = false, className, children }: LencanaProps) {
  return (
    <span className={cn(styles.lencana, styles[nada], className)}>
      {Ikon ? (
        <Ikon size={14} strokeWidth={1.75} aria-hidden="true" />
      ) : titik ? (
        <span className={styles.titik} aria-hidden="true" />
      ) : null}
      {children}
    </span>
  );
}
