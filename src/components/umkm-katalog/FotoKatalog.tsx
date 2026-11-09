'use client';

import { useState } from 'react';
import FotoUmkm from '@/components/umkm/FotoUmkm';
import Tombol from '@/components/ui/Tombol';
import styles from './katalog.module.css';

export default function FotoKatalog({ src, alt }: { src: string | null; alt: string }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  return <div className={styles.foto} onErrorCapture={() => setFailed(true)}>
    {src ? <>
      <FotoUmkm key={`${src}:${attempt}`} src={src} alt={alt} width={480} height={320}
        style={{ width: '100%', height: 220 }} />
      {failed && <Tombol varian="hantu" onClick={() => { setFailed(false); setAttempt((value) => value + 1); }}
        aria-label={`Coba lagi memuat ${alt.toLowerCase()}`}>Coba lagi memuat foto</Tombol>}
    </> : <p className={styles.tanpaFoto}>Foto belum tersedia</p>}
  </div>;
}
