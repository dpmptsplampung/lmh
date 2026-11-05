import { AlertCircle, CalendarOff, DatabaseZap, Filter, Inbox, Info, Store } from 'lucide-react';
import type { ElementType, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import styles from './CatatanKeadaan.module.css';

export type JenisKeadaan = 'kosong' | 'libur' | 'tanpa-layanan' | 'menunggu-migrasi' | 'lingkup' | 'info' | 'galat';

export interface CatatanKeadaanProps {
  /**
   * Alasan layar tampak kosong atau terbatas. Jenis menentukan ikon, nada, dan label untuk pembaca layar,
   * sehingga "memang kosong", "libur", "fitur belum aktif", "lingkup data terbatas", dan "galat" tidak tampak sama.
   */
  jenis: JenisKeadaan;
  judul?: string;
  /** Penjelasan singkat, mis. "Hari ini libur: Hari Raya; antrean tidak dibuka." */
  children: ReactNode;
  /** Aksi opsional (mis. tombol Coba lagi atau tautan). */
  aksi?: ReactNode;
  className?: string;
}

type Ikon = ElementType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean | 'true' }>;

const KONFIG: Record<JenisKeadaan, { ikon: Ikon; nada: 'netral' | 'info' | 'bahaya'; label: string }> = {
  kosong: { ikon: Inbox, nada: 'netral', label: 'Belum ada data' },
  libur: { ikon: CalendarOff, nada: 'info', label: 'Hari libur' },
  'tanpa-layanan': { ikon: Store, nada: 'info', label: 'Tidak ada layanan aktif' },
  'menunggu-migrasi': { ikon: DatabaseZap, nada: 'info', label: 'Fitur belum aktif' },
  lingkup: { ikon: Filter, nada: 'netral', label: 'Lingkup data' },
  info: { ikon: Info, nada: 'info', label: 'Catatan' },
  galat: { ikon: AlertCircle, nada: 'bahaya', label: 'Terjadi masalah' },
};

// Catatan kontekstual berwarna netral/info (bukan merah) untuk menjelaskan MENGAPA sebuah layar kosong atau terbatas.
// Hanya jenis `galat` yang diumumkan sebagai alert; pemuatan ulang sungguhan tetap lewat <Galat>.
export default function CatatanKeadaan({ jenis, judul, children, aksi, className }: CatatanKeadaanProps) {
  const { ikon: Ikon, nada, label } = KONFIG[jenis];
  return (
    <div
      className={cn(styles.catatan, styles[nada], className)}
      role={jenis === 'galat' ? 'alert' : 'note'}
      data-jenis={jenis}
    >
      <Ikon size={18} strokeWidth={1.75} aria-hidden="true" />
      <div className={styles.isi}>
        {judul ? (
          <p className={styles.judul}>
            <span className="sr-only">{label}: </span>
            {judul}
          </p>
        ) : (
          <span className="sr-only">{label}: </span>
        )}
        <div className={styles.teks}>{children}</div>
      </div>
      {aksi && <div className={styles.aksi}>{aksi}</div>}
    </div>
  );
}
