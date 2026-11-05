import type { ElementType, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import styles from './StatusKosong.module.css';

export interface StatusKosongProps {
  ikon: ElementType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean | 'true' }>;
  judul: string;
  isi?: ReactNode;
  /** Aksi utama (mis. <Tombol>), tampil di bawah teks. */
  aksi?: ReactNode;
  className?: string;
}

// Keadaan kosong yang memang kosong. Untuk kosong karena libur/menunggu migrasi/lingkup pakai CatatanKeadaan,
// untuk galat pakai Galat: ketiganya tidak boleh tampak sama.
export default function StatusKosong({ ikon: Ikon, judul, isi, aksi, className }: StatusKosongProps) {
  return (
    <div className={cn(styles.wadah, className)}>
      <span className={styles.ikon}>
        <Ikon size={24} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <p className={styles.judul}>{judul}</p>
      {isi && <div className={styles.isi}>{isi}</div>}
      {aksi && <div className={styles.aksi}>{aksi}</div>}
    </div>
  );
}
