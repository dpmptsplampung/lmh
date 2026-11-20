'use client';

import { Area, Teks, type DasarIsian } from './isian';
import styles from '../../FormIpro.module.css';

export default function TabInggris({ ringkas = false, ...d }: DasarIsian & { ringkas?: boolean }) {
  return (
    <div className={styles.bidang}>
      <p className={`${styles.catatan} ${styles.lebar}`}>
        Opsional. Halaman publik v1 berbahasa Indonesia; isian ini disimpan untuk versi Inggris kelak.
      </p>
      <div className={styles.lebar}><Teks {...d} k="judul_en" label="Judul (Inggris)" maks={200} /></div>
      <div className={styles.lebar}><Area {...d} k="ringkasan_en" label="Ringkasan (Inggris)" baris={3} maks={600} /></div>
      {!ringkas && <div className={styles.lebar}><Area {...d} k="deskripsi_en" label="Deskripsi (Inggris)" baris={8} maks={20000} /></div>}
    </div>
  );
}
