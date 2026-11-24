'use client';

import { useState } from 'react';
import { FileText, Mail } from 'lucide-react';
import type { DokumenPublik } from '@/lib/investasi/dokumen';
import Lencana from '@/components/ui/Lencana';
import Tombol from '@/components/ui/Tombol';
import { dokumenSiap, sampulDokumen, teksHalaman } from './dokumen-logika';
import { useAksiDokumen } from './PenyediaDokumen';
import styles from './dokumen.module.css';

/** Sampul halaman 1 (varian kecil ber-watermark) dengan ruang tetap dan pengganti saat belum siap atau gagal dimuat. */
export function SampulDokumen({ dokumen, className }: { dokumen: DokumenPublik; className?: string }) {
  const [gagal, setGagal] = useState(false);
  const url = sampulDokumen(dokumen);
  return (
    <div className={`${styles.sampul} ${className ?? ''}`}>
      {url && !gagal ? (
        // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/no-noninteractive-element-interactions -- WebP ber-watermark dari rute origin (cookie sesi harus sampai; tidak lewat optimizer)
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className={styles.sampulGambar}
          onError={() => setGagal(true)}
        />
      ) : (
        <span className={styles.sampulKosong} aria-hidden="true"><FileText size={40} strokeWidth={1.5} /></span>
      )}
    </div>
  );
}

/**
 * Kartu dokumen tunggal untuk /gallery dan hub: seluruh kartu = aksi "Lihat dokumen" (satu tombol pada judul yang
 * membentang lewat ::after, tanpa menyarangkan elemen interaktif); "Ajukan minat" adalah aksi sekunder.
 */
export default function KartuDokumen({ dokumen }: { dokumen: DokumenPublik }) {
  const { buka, minat } = useAksiDokumen();
  const halaman = teksHalaman(dokumen);
  const siap = dokumenSiap(dokumen);
  return (
    <article className={styles.kartu}>
      <SampulDokumen dokumen={dokumen} />
      <div className={styles.isi}>
        <div className={styles.meta}>
          <Lencana nada={dokumen.sorotan ? 'primer' : 'netral'}>{dokumen.kategori}</Lencana>
          {halaman ? <span className={styles.halaman}>{halaman}</span> : <span className={styles.halaman}>Sedang diproses</span>}
        </div>
        <h3 className={styles.judul}>
          <button type="button" className={styles.pemicu} onClick={() => buka(dokumen)}>
            {dokumen.judul}
            <span className="sr-only">, lihat dokumen</span>
          </button>
        </h3>
        {dokumen.deskripsi && <p className={styles.deskripsi}>{dokumen.deskripsi}</p>}
        {dokumen.nilai_investasi && (
          <p className={styles.nilai}><span className={styles.nilaiLabel}>Nilai</span> {dokumen.nilai_investasi}</p>
        )}
        <div className={styles.aksi}>
          <span className={styles.lihat} aria-hidden="true">{siap ? 'Lihat dokumen' : 'Lihat keterangan'}</span>
          <Tombol varian="sekunder" ukuran="kecil" ikon={Mail} onClick={() => minat(dokumen)}
            aria-label={`Ajukan minat: ${dokumen.judul}`}>
            Ajukan minat
          </Tombol>
        </div>
      </div>
    </article>
  );
}
