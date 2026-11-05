import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { Key, ReactNode } from 'react';
import Kartu from '../Kartu';
import Tabel, { type KolomTabel } from '../Tabel';
import styles from './TabelRingkas.module.css';

export interface TabelRingkasProps<T> {
  judul: string;
  aksi?: ReactNode;
  kolom: KolomTabel<T>[];
  baris: T[];
  kunciBaris: keyof T | ((baris: T, indeks: number) => Key);
  /** Jumlah baris maksimum yang ditampilkan. Bawaan 5. */
  maks?: number;
  /** Tautan "Lihat semua" di dasar kartu. */
  lihatSemua?: { href: string; label?: string };
  memuat?: boolean;
  kosong?: ReactNode;
  className?: string;
}

// Widget tabel ringkas (maks 5 baris) di dalam Kartu, dengan tautan "Lihat semua".
export default function TabelRingkas<T>({ judul, aksi, kolom, baris, kunciBaris, maks = 5, lihatSemua, memuat, kosong, className }: TabelRingkasProps<T>) {
  return (
    <Kartu judul={judul} aksi={aksi} padding="tanpa" className={className}>
      <Tabel kolom={kolom} baris={baris.slice(0, maks)} kunciBaris={kunciBaris} caption={`Rincian ${judul}`} padat memuat={memuat} kosong={kosong} />
      {lihatSemua && (
        <div className={styles.kaki}>
          <Link href={lihatSemua.href} className={styles.tautan}>
            {lihatSemua.label ?? 'Lihat semua'}
            <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        </div>
      )}
    </Kartu>
  );
}
