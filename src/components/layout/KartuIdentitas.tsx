'use client';

// Kartu identitas di sidebar: avatar inisial, nama, peran (+ Layanan). Seluruh kartu adalah tombol menu
// (pola ARIA menu button) berisi Profil Saya dan Keluar.
import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronsUpDown, LogOut, UserCircle } from 'lucide-react';
import styles from './KartuIdentitas.module.css';

export interface KartuIdentitasProps {
  nama: string;
  /** "Petugas", "Front Office", "Admin". */
  peran: string;
  /** Nama Layanan petugas, bila ada. */
  layanan?: string | null;
  onKeluar: () => void;
  /** Dipanggil saat tautan menu dipilih (mis. menutup laci). */
  onNavigasi?: () => void;
}

/** Dua huruf: huruf pertama dua kata pertama; satu kata = dua huruf pertamanya; kosong = "?". */
export function inisialDari(nama: string): string {
  const kata = nama.trim().split(/\s+/).filter(Boolean);
  if (kata.length === 0) return '?';
  const huruf = kata.length === 1 ? Array.from(kata[0]).slice(0, 2) : [Array.from(kata[0])[0], Array.from(kata[1])[0]];
  return huruf.join('').toLocaleUpperCase('id-ID');
}

export default function KartuIdentitas({ nama, peran, layanan, onKeluar, onNavigasi }: KartuIdentitasProps) {
  const [buka, setBuka] = useState(false);
  const wadah = useRef<HTMLDivElement>(null);
  const tombol = useRef<HTMLButtonElement>(null);
  const item = useRef<(HTMLElement | null)[]>([]);
  const idMenu = useId();

  const keterangan = layanan ? `${peran} · ${layanan}` : peran;

  const tutup = (kembaliFokus: boolean) => {
    setBuka(false);
    if (kembaliFokus) tombol.current?.focus();
  };
  const fokusItem = (i: number) => {
    const daftar = item.current.filter((el): el is HTMLElement => !!el);
    if (daftar.length === 0) return;
    daftar[(i + daftar.length) % daftar.length].focus();
  };

  // Klik di luar menutup menu.
  useEffect(() => {
    if (!buka) return;
    const saatKlik = (e: MouseEvent) => {
      if (wadah.current && !wadah.current.contains(e.target as Node)) setBuka(false);
    };
    document.addEventListener('mousedown', saatKlik);
    return () => document.removeEventListener('mousedown', saatKlik);
  }, [buka]);

  // Menu terbuka: fokus ke item pertama.
  useEffect(() => {
    if (buka) item.current.find((el) => el)?.focus();
  }, [buka]);

  const saatTombolKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setBuka(true);
    }
  };
  const saatMenuKey = (e: React.KeyboardEvent) => {
    const daftar = item.current.filter((el): el is HTMLElement => !!el);
    const sekarang = daftar.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      tutup(true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      fokusItem(sekarang + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      fokusItem(sekarang - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      fokusItem(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      fokusItem(daftar.length - 1);
    } else if (e.key === 'Tab') {
      setBuka(false);
    }
  };

  return (
    <div className={styles.wadah} ref={wadah}>
      <button
        ref={tombol}
        type="button"
        className={styles.kartu}
        aria-haspopup="menu"
        aria-expanded={buka}
        aria-controls={buka ? idMenu : undefined}
        onClick={() => setBuka((b) => !b)}
        onKeyDown={saatTombolKey}
      >
        <span className={styles.avatar} aria-hidden="true">{inisialDari(nama)}</span>
        <span className={styles.teks}>
          <span className={styles.nama} title={nama || undefined}>{nama || 'Pengguna'}</span>{' '}
          <span className={styles.peran} title={keterangan}>{keterangan}</span>
        </span>
        <ChevronsUpDown size={16} strokeWidth={1.75} aria-hidden="true" className={styles.ikon} />
      </button>
      {buka && (
        <div id={idMenu} role="menu" aria-label="Menu akun" tabIndex={-1} className={styles.menu} onKeyDown={saatMenuKey}>
          <Link
            href="/admin/profil"
            role="menuitem"
            className={styles.butir}
            ref={(el: HTMLAnchorElement | null) => { item.current[0] = el; }}
            onClick={() => { setBuka(false); onNavigasi?.(); }}
          >
            <UserCircle size={18} strokeWidth={1.75} aria-hidden="true" />
            Profil Saya
          </Link>
          <button
            type="button"
            role="menuitem"
            className={styles.butir}
            ref={(el) => { item.current[1] = el; }}
            onClick={() => { setBuka(false); onKeluar(); }}
          >
            <LogOut size={18} strokeWidth={1.75} aria-hidden="true" />
            Keluar
          </button>
        </div>
      )}
    </div>
  );
}
