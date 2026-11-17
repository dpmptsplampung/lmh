'use client';

// Indikator simpan otomatis draf Pendataan Khusus. Teks selalu tampil (tidak hanya warna); role=status untuk kemajuan,
// role=alert hanya untuk galat.
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { formatWaktu } from '@/lib/utils';
import type { StatusSimpanDraf } from './useDrafKhusus';
import styles from './MulaiLayanan.module.css';

interface Props {
  status: StatusSimpanDraf;
  terakhir: Date | null;
  galat: string | null;
  bolehUbah: boolean;
}

export default function IndikatorDraf({ status, terakhir, galat, bolehUbah }: Props) {
  if (!bolehUbah) {
    return <p className={styles.indikator} role="status">Hanya dapat dibaca. Draf diisi oleh petugas yang melayani tiket ini.</p>;
  }
  if (status === 'galat') {
    return (
      <p className={`${styles.indikator} ${styles.indikatorGalat}`} role="alert">
        <AlertCircle size={14} aria-hidden="true" /> {galat ?? 'Draf belum tersimpan.'}
      </p>
    );
  }
  return (
    <p className={`${styles.indikator}${status === 'tersimpan' ? ` ${styles.indikatorOk}` : ''}`} role="status" aria-live="polite">
      {status === 'menyimpan' && (<><Loader2 size={14} aria-hidden="true" /> Menyimpan draf…</>)}
      {status === 'tersimpan' && (<><Check size={14} aria-hidden="true" /> Draf tersimpan{terakhir ? ` pukul ${formatWaktu(terakhir)} WIB` : ''}</>)}
      {status === 'diam' && 'Isian tersimpan otomatis sebagai draf.'}
    </p>
  );
}
