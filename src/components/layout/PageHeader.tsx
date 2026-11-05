import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './PageHeader.module.css';

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Aksi halaman (tombol), rata kanan; di HP turun ke baris bawah dan bisa digulir horizontal. */
  children?: ReactNode;
  /** Keterangan kecil di bawah deskripsi: label lingkup data, tanggal WIB, "Data terakhir 10.42 WIB". */
  meta?: ReactNode;
  /** Tautan kembali di atas judul (halaman anak). */
  kembali?: { href: string; label: string };
}

// Kepala halaman: satu <h1> per halaman. Kompatibel dengan pemakaian lama (title, description, children).
export default function PageHeader({ title, description, children, meta, kembali }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.headerLeft}>
        {kembali && (
          <Link href={kembali.href} className={styles.kembali}>
            <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
            {kembali.label}
          </Link>
        )}
        <h1 className={styles.headerTitle}>{title}</h1>
        {description && <p className={styles.headerDescription}>{description}</p>}
        {meta && <div className={styles.meta}>{meta}</div>}
      </div>
      {children && <div className={styles.headerRight}>{children}</div>}
    </header>
  );
}
