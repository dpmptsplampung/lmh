'use client';

import { Mail, Map } from 'lucide-react';
import type { DokumenPublik } from '@/lib/investasi/dokumen';
import Tombol from '@/components/ui/Tombol';
import { SampulDokumen } from './KartuDokumen';
import { teksHalaman } from './dokumen-logika';
import { useAksiDokumen } from './PenyediaDokumen';
import styles from './dokumen.module.css';

/**
 * Sorotan Peta Potensi: area istimewa di atas daftar dokumen (gallery dan hub). Dokumennya dikenali lewat kategori
 * tetap "Peta Potensi"; tanpa dokumen, induk tidak merender komponen ini.
 */
export default function SorotanPetaPotensi({ dokumen, idJudul = 'judul-sorotan-peta' }: { dokumen: DokumenPublik; idJudul?: string }) {
  const { buka, minat } = useAksiDokumen();
  const halaman = teksHalaman(dokumen);
  return (
    <section id="peta-potensi" className={styles.sorotan} aria-labelledby={idJudul}>
      <SampulDokumen dokumen={dokumen} className={styles.sorotanSampul} />
      <div className={styles.sorotanIsi}>
        <h2 id={idJudul} className={styles.sorotanJudul}>{dokumen.judul}</h2>
        {dokumen.deskripsi && <p className={styles.sorotanDeskripsi}>{dokumen.deskripsi}</p>}
        {halaman && <p className={styles.sorotanFakta}>{halaman}, dapat dibaca daring (hanya lihat)</p>}
        <div className={styles.sorotanAksi}>
          <Tombol varian="aksen" ukuran="besar" ikon={Map} onClick={() => buka(dokumen)}>Buka Peta Potensi</Tombol>
          <Tombol varian="sekunder" ukuran="besar" ikon={Mail} onClick={() => minat(dokumen)}>Ajukan minat</Tombol>
        </div>
      </div>
    </section>
  );
}
