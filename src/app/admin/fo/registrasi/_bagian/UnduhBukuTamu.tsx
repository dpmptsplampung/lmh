'use client';

import { Download } from 'lucide-react';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import Tombol from '@/components/ui/Tombol';
import type { FormatUnduh } from '@/lib/data/buku-tamu';
import styles from './bukuTamu.module.css';

export interface UnduhBukuTamuProps {
  sedang: FormatUnduh | null;
  /** Rentang tidak valid / sedang memuat: tombol nonaktif. */
  nonaktif: boolean;
  onUnduh: (f: FormatUnduh) => void;
}

// Tombol unduh sesuai filter yang sedang tampil. Pesan galat/peringatan ditampilkan oleh <CatatanUnduh>.
export default function UnduhBukuTamu({ sedang, nonaktif, onUnduh }: UnduhBukuTamuProps) {
  return (
    <div className={styles.unduh} role="group" aria-label="Unduh buku tamu sesuai filter">
      <Tombol ikon={Download} varian="sekunder" disabled={nonaktif || sedang !== null} memuat={sedang === 'xlsx'} onClick={() => onUnduh('xlsx')}>
        Unduh XLSX
      </Tombol>
      <Tombol ikon={Download} varian="sekunder" disabled={nonaktif || sedang !== null} memuat={sedang === 'csv'} onClick={() => onUnduh('csv')}>
        Unduh CSV
      </Tombol>
    </div>
  );
}

export function CatatanUnduh({ galat, peringatan }: { galat: string; peringatan: string }) {
  if (galat) {
    return <CatatanKeadaan jenis="galat" judul="Unduhan gagal" className={styles.catatan}>{galat}</CatatanKeadaan>;
  }
  if (peringatan) {
    return <CatatanKeadaan jenis="info" judul="Data terpotong" className={styles.catatan}>{peringatan}</CatatanKeadaan>;
  }
  return null;
}
