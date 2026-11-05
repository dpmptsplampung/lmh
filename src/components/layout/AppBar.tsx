'use client';

// Bilah atas area admin. <=1024px: tombol menu (membuka laci), logo kecil, judul halaman aktif, total lencana.
// Desktop: tombol "Buka menu atau tindakan  Ctrl K" (PerintahCepat). Semua ukuran: penghitung offline (A10).
import { useRef, useState } from 'react';
import Image from 'next/image';
import { Menu, Search } from 'lucide-react';
import { teksAntreanOffline, useAntreanOffline } from '@/lib/hooks/useAntreanOffline';
import PerintahCepat from './PerintahCepat';
import styles from './AppBar.module.css';

export interface AppBarProps {
  role: string | null | undefined;
  /** Judul halaman aktif (label entri menu). */
  judul: string;
  /** Jumlah total lencana menu. */
  total: number;
  laciTerbuka: boolean;
  onToggleLaci: () => void;
  toggleRef: React.RefObject<HTMLButtonElement | null>;
}

export default function AppBar({ role, judul, total, laciTerbuka, onToggleLaci, toggleRef }: AppBarProps) {
  const [perintahBuka, setPerintahBuka] = useState(false);
  const perintahRef = useRef<HTMLButtonElement>(null);
  const { jumlah, terkirim } = useAntreanOffline(!!role);
  const teksOffline = teksAntreanOffline(jumlah);

  return (
    <>
      <header className={styles.bar} data-appbar data-cetak="sembunyi">
        <button
          ref={toggleRef}
          type="button"
          className={styles.menu}
          aria-label="Buka menu"
          aria-expanded={laciTerbuka}
          aria-controls="sidebar"
          onClick={onToggleLaci}
        >
          <Menu size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <span className={styles.merek} aria-hidden="true">
          <Image src="/logo.png" alt="" width={334} height={267} className={styles.logo} />
        </span>
        <span className={styles.judul}>{judul}</span>
        {total > 0 && (
          <span className={styles.total}>
            <span className={styles.angka} aria-hidden="true">{total > 99 ? '99+' : total}</span>
            <span className={styles.srOnly}>{`${total} pemberitahuan menunggu`}</span>
          </span>
        )}
        <div className={styles.kanan}>
          {(teksOffline || terkirim) && (
            <span className={terkirim ? styles.offlineOk : styles.offline} role="status">
              {teksOffline ?? 'Terkirim'}
            </span>
          )}
          {role && (
            <button
              ref={perintahRef}
              type="button"
              className={styles.perintah}
              aria-haspopup="dialog"
              aria-expanded={perintahBuka}
              aria-keyshortcuts="Control+K"
              onClick={() => setPerintahBuka(true)}
            >
              <Search size={16} strokeWidth={1.75} aria-hidden="true" />
              <span className={styles.teksPerintah}>Buka menu atau tindakan</span>
              <kbd className={styles.kbd} aria-hidden="true">Ctrl K</kbd>
            </button>
          )}
        </div>
      </header>
      {role && <PerintahCepat role={role} buka={perintahBuka} onUbah={setPerintahBuka} pembukaRef={perintahRef} />}
    </>
  );
}
