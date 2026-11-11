import type { ReactNode } from 'react';
import styles from './IsiHalaman.module.css';

export interface IsiHalamanProps {
  /**
   * penuh (bawaan) = selebar --content-max, rata kiri di bawah PageHeader.
   * baca = kolom lebih sempit dan terpusat, untuk halaman bergaya formulir atau profil.
   */
  lebar?: 'penuh' | 'baca';
  children: ReactNode;
}

// Pembungkus isi halaman admin di bawah <PageHeader>. Satu-satunya pemegang padding halaman (--pad-page),
// lebar maksimum (--content-max), dan jarak antaranak (--gap-grid); modul halaman tidak boleh mengulanginya.
// Anak langsung ditata grid satu kolom yang boleh menyusut, jadi tabel lebar menggulir di wadahnya sendiri.
export default function IsiHalaman({ lebar = 'penuh', children }: IsiHalamanProps) {
  return (
    <div className={styles.isi} data-lebar={lebar}>
      {children}
    </div>
  );
}
