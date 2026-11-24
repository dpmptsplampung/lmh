'use client';

import type { CSSProperties } from 'react';
import type { TautanTampil } from './dokumen-logika';
import styles from './penampil.module.css';

type Props = {
  tautan: TautanTampil[];
  satuan: 'slide' | 'halaman';
  onLompat: (ke: number) => void;
};

const persen = (n: number) => `${(n * 100).toFixed(3)}%`;

/** Area klik di atas gambar halaman; induknya (`.kotak`) seukuran gambar sehingga persen mengikuti gambar. */
export default function LapisanTautan({ tautan, satuan, onLompat }: Props) {
  return (
    <>
      {tautan.map(t => {
        const gaya: CSSProperties = { left: persen(t.x), top: persen(t.y), width: persen(t.w), height: persen(t.h) };
        return t.jenis === 'internal' ? (
          <button key={t.id} type="button" className={styles.tautan} style={gaya} aria-label={`Ke ${satuan} ${t.ke}`} onClick={() => onLompat(t.ke)} />
        ) : (
          <a key={t.id} href={t.url} target="_blank" rel="noopener noreferrer" className={styles.tautan} style={gaya} aria-label={`Buka tautan luar: ${t.host}`} />
        );
      })}
    </>
  );
}
