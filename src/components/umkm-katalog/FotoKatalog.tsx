'use client';

import { useState } from 'react';
import FotoUmkm from '@/components/umkm/FotoUmkm';
import Tombol from '@/components/ui/Tombol';
import styles from './katalog.module.css';
import publik from './publik.module.css';

// Tanpa `isi`: tampilan lama (dipakai juga oleh admin). Dengan `isi`: foto memenuhi bingkai induk
// (induk menentukan rasio), dan tanpa foto tampil bidang warna berisi inisial nama usaha.
export default function FotoKatalog({ src, alt, isi = false, inisial, className }: {
  src: string | null; alt: string; isi?: boolean; inisial?: string; className?: string;
}) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const ulang = failed && <Tombol varian="hantu" ukuran={isi ? 'kecil' : undefined}
    className={isi ? publik.fotoUlang : undefined}
    onClick={() => { setFailed(false); setAttempt((value) => value + 1); }}
    aria-label={`Coba lagi memuat ${alt.toLowerCase()}`}>Coba lagi memuat foto</Tombol>;
  if (isi) {
    return <div className={`${publik.foto} ${className ?? ''}`} onErrorCapture={() => setFailed(true)}>
      {src ? <>
        <FotoUmkm key={`${src}:${attempt}`} src={src} alt={alt} fill />
        {ulang}
      </> : <div className={publik.fotoKosong}>
        {inisial && <span className={publik.inisial} aria-hidden="true">{inisial}</span>}
        <span className={publik.fotoKosongTeks}>Foto belum tersedia</span>
      </div>}
    </div>;
  }
  return <div className={styles.foto} onErrorCapture={() => setFailed(true)}>
    {src ? <>
      <FotoUmkm key={`${src}:${attempt}`} src={src} alt={alt} width={480} height={320}
        style={{ width: '100%', height: 220 }} />
      {ulang}
    </> : <p className={styles.tanpaFoto}>Foto belum tersedia</p>}
  </div>;
}

/** Dua huruf awal nama usaha untuk bidang tanpa foto. */
export function inisialNama(nama: string) {
  const kata = nama.split(/\s+/).filter((k) => /\p{L}/u.test(k));
  return kata.slice(0, 2).map((k) => k.match(/\p{L}/u)?.[0] ?? '').join('').toUpperCase();
}
