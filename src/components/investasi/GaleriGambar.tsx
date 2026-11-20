'use client';

import { useState, type KeyboardEvent } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { GambarIproPublik } from '@/lib/data/publik-server';
import Dialog from '@/components/ui/Dialog';
import Tombol from '@/components/ui/Tombol';
import styles from './investasi.module.css';

type GambarGaleri = Pick<GambarIproPublik, 'id' | 'url' | 'url_mini' | 'alt' | 'lebar' | 'tinggi' | 'keterangan'>;

/** Galeri foto proyek: kisi gambar kecil; klik membuka dialog dengan gambar besar, tombol Sebelumnya/Berikutnya, dan panah papan ketik. */
export default function GaleriGambar({ gambar, judul }: { gambar: GambarGaleri[]; judul: string }) {
  const [terbuka, setTerbuka] = useState<number | null>(null);
  if (!gambar.length) return null;
  const aktif = terbuka === null ? null : gambar[terbuka] ?? null;
  const geser = (arah: 1 | -1) =>
    setTerbuka(i => (i === null ? null : (i + arah + gambar.length) % gambar.length));
  const tekanTombol = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); geser(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); geser(-1); }
  };

  return (
    <>
      <ul className={styles.galeri}>
        {gambar.map((g, indeks) => (
          <li key={g.id}>
            <button
              type="button"
              className={styles.galeriPemicu}
              onClick={() => setTerbuka(indeks)}
              aria-label={`Perbesar foto ${indeks + 1} dari ${gambar.length}: ${g.alt}`}
            >
              <Image src={g.url_mini} alt="" width={g.lebar} height={g.tinggi} sizes="(max-width: 640px) 50vw, 25vw" unoptimized />
            </button>
          </li>
        ))}
      </ul>
      {aktif && (
        <Dialog terbuka onTutup={() => setTerbuka(null)} judul={`Foto ${judul}`} deskripsi={`Foto ${(terbuka ?? 0) + 1} dari ${gambar.length}`} lebarMaks={960}>
          {/* Panah papan ketik hanya berlaku di dalam dialog (isi dialog menerima fokus). */}
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- penangkap panah untuk anak yang dapat difokus */}
          <div className={styles.galeriBesar} onKeyDown={tekanTombol}>
            <Image src={aktif.url} alt={aktif.alt} width={aktif.lebar} height={aktif.tinggi} sizes="(max-width: 1024px) 100vw, 900px" unoptimized priority />
            {aktif.keterangan && <p className={styles.galeriKeterangan}>{aktif.keterangan}</p>}
            {gambar.length > 1 && (
              <div className={styles.galeriNav}>
                <Tombol varian="sekunder" ukuran="kecil" ikon={ChevronLeft} onClick={() => geser(-1)}>Sebelumnya</Tombol>
                <Tombol varian="sekunder" ukuran="kecil" ikonAkhir={ChevronRight} onClick={() => geser(1)}>Berikutnya</Tombol>
              </div>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
