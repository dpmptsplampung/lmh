'use client';

import Link from 'next/link';
import { MoreHorizontal } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ElementType, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import styles from './MenuTitikTiga.module.css';

export interface ItemMenu {
  kunci?: string;
  label: string;
  ikon?: ElementType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean | 'true' }>;
  /** Aksi; menu menutup lebih dulu lalu fokus kembali ke tombol. */
  onPilih?: () => void;
  /** Bila ada, item menjadi tautan. */
  href?: string;
  bahaya?: boolean;
  nonaktif?: boolean;
}

export interface MenuTitikTigaProps {
  item: ItemMenu[];
  /** Nama tombol untuk pembaca layar, mis. "Aksi untuk OS-014". */
  label?: string;
  /** Menu rata kiri tombol (bawaan: rata kanan). */
  rataKiri?: boolean;
  className?: string;
}

// Menu tombol ARIA: tombol dengan aria-haspopup="menu", panah atas/bawah, Home/End, Esc menutup dan mengembalikan
// fokus, Tab menutup, klik di luar menutup. Area sentuh 40px.
export default function MenuTitikTiga({ item, label = 'Aksi lainnya', rataKiri = false, className }: MenuTitikTigaProps) {
  const [terbuka, setTerbuka] = useState(false);
  const id = useId();
  const idMenu = `${id}-menu`;
  const wadah = useRef<HTMLDivElement>(null);
  const tombol = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const butirAktif = () =>
    Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);

  useEffect(() => {
    if (!terbuka) return;
    butirAktif()[0]?.focus();
    const klikLuar = (e: MouseEvent) => {
      if (wadah.current && !wadah.current.contains(e.target as Node)) setTerbuka(false);
    };
    document.addEventListener('mousedown', klikLuar);
    return () => document.removeEventListener('mousedown', klikLuar);
  }, [terbuka]);

  const tutup = (kembaliFokus: boolean) => {
    setTerbuka(false);
    if (kembaliFokus) tombol.current?.focus();
  };

  const tombolKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setTerbuka(true);
    }
  };

  const menuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const daftar = butirAktif();
    const i = daftar.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      daftar[(i + 1) % daftar.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      daftar[(i - 1 + daftar.length) % daftar.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      daftar[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      daftar[daftar.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      tutup(true);
    } else if (e.key === 'Tab') {
      setTerbuka(false);
    }
  };

  return (
    <div ref={wadah} className={cn(styles.wadah, className)}>
      <button
        ref={tombol}
        type="button"
        className={styles.tombol}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={terbuka}
        aria-controls={terbuka ? idMenu : undefined}
        onClick={() => setTerbuka((b) => !b)}
        onKeyDown={tombolKey}
      >
        <MoreHorizontal size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {terbuka && (
        <div
          ref={menu}
          id={idMenu}
          role="menu"
          tabIndex={-1}
          aria-label={label}
          className={cn(styles.menu, rataKiri && styles.rataKiri)}
          onKeyDown={menuKey}
        >
          {item.map((it, i) => {
            const Ikon = it.ikon;
            const kelas = cn(styles.butir, it.bahaya && styles.bahaya);
            const isi = (
              <>
                {Ikon && <Ikon size={16} strokeWidth={1.75} aria-hidden="true" />}
                {it.label}
              </>
            );
            const kunci = it.kunci ?? `${i}-${it.label}`;
            if (it.href && !it.nonaktif) {
              return (
                <Link key={kunci} href={it.href} role="menuitem" className={kelas} tabIndex={-1} onClick={() => setTerbuka(false)}>
                  {isi}
                </Link>
              );
            }
            return (
              <button
                key={kunci}
                type="button"
                role="menuitem"
                className={kelas}
                tabIndex={-1}
                aria-disabled={it.nonaktif || undefined}
                onClick={() => {
                  if (it.nonaktif) return;
                  tutup(true);
                  it.onPilih?.();
                }}
              >
                {isi}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
