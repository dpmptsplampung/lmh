'use client';

import { CalendarDays, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import styles from './PopoverKalender.module.css';

export interface PopoverKalenderProps {
  /** Teks chip yang terlihat, mis. "4 Nov 2026". */
  teks: string;
  /** Nama tombol untuk pembaca layar, mis. "Tanggal: 4 November 2026". */
  labelTombol: string;
  /** Nama dialog popover dan judul lembar bawah di HP. */
  labelDialog: string;
  id?: string;
  disabled?: boolean;
  className?: string;
  'aria-describedby'?: string;
  /** Isi popover; dirender hanya saat terbuka, jadi state di dalamnya selalu segar. Tutup lewat `useTutupPopover()`. */
  children: ReactNode;
}

type Tutup = (kembaliFokus?: boolean) => void;

const KonteksTutup = createContext<Tutup>(() => {});

/** Dipakai isi popover untuk menutupnya (setelah memilih, Terapkan, Batal). `tutup(false)` tidak mengembalikan fokus ke tombol. */
export function useTutupPopover(): Tutup {
  return useContext(KonteksTutup);
}

const FOKUSABLE = 'button:not([disabled]):not([tabindex="-1"]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Cangkang bersama PemilihTanggal dan PemilihRentang: tombol chip + popover role="dialog". Esc menutup dan mengembalikan
// fokus ke tombol, klik di luar menutup, Tab dijebak di dalam. Di layar <= 640px popover menjadi lembar bawah dengan latar redup.
export default function PopoverKalender({
  teks,
  labelTombol,
  labelDialog,
  id,
  disabled,
  className,
  children,
  ...aria
}: PopoverKalenderProps) {
  const [terbuka, setTerbuka] = useState(false);
  const idDialog = useId();
  const wadah = useRef<HTMLDivElement>(null);
  const tombol = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const kepala = useRef<HTMLDivElement>(null);

  const tutup = useCallback<Tutup>((kembaliFokus = true) => {
    setTerbuka(false);
    if (kembaliFokus) tombol.current?.focus();
  }, []);

  // Fokus masuk: hari yang memegang tabindex 0, kalau tidak ada dialognya sendiri.
  useEffect(() => {
    if (!terbuka) return;
    const target = dialog.current?.querySelector<HTMLElement>('[role="grid"] button[tabindex="0"]') ?? dialog.current;
    target?.focus();
  }, [terbuka]);

  // Klik atau sentuh di luar menutup tanpa merebut fokus dari kontrol yang diklik.
  useEffect(() => {
    if (!terbuka) return;
    const luar = (e: Event) => {
      if (wadah.current && !wadah.current.contains(e.target as Node)) setTerbuka(false);
    };
    document.addEventListener('pointerdown', luar);
    document.addEventListener('mousedown', luar);
    return () => {
      document.removeEventListener('pointerdown', luar);
      document.removeEventListener('mousedown', luar);
    };
  }, [terbuka]);

  // Penempatan sederhana: terbuka ke bawah, rata kiri chip; bila melewati tepi kanan layar, rata kanan.
  useLayoutEffect(() => {
    const el = dialog.current;
    if (!terbuka || !el) return;
    const kotak = el.getBoundingClientRect();
    if (kotak.width > 0 && kotak.right > window.innerWidth - 8) el.classList.add(styles.rataKanan);
  }, [terbuka]);

  const tombolPapan = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      tutup(true);
      return;
    }
    if (e.key !== 'Tab') return;
    // Kepala (judul + tombol Tutup) hanya tampil di lembar bawah HP; di layar lebar ia disembunyikan CSS.
    const kepalaTersembunyi = Boolean(kepala.current && getComputedStyle(kepala.current).display === 'none');
    const daftar = Array.from(dialog.current?.querySelectorAll<HTMLElement>(FOKUSABLE) ?? []).filter(
      (el) => !(kepalaTersembunyi && kepala.current?.contains(el)),
    );
    if (daftar.length === 0) {
      e.preventDefault();
      return;
    }
    const awal = daftar[0];
    const akhir = daftar[daftar.length - 1];
    const aktif = document.activeElement;
    if (e.shiftKey && (aktif === awal || aktif === dialog.current)) {
      e.preventDefault();
      akhir.focus();
    } else if (!e.shiftKey && aktif === akhir) {
      e.preventDefault();
      awal.focus();
    }
  };

  return (
    <div ref={wadah} className={cn(styles.wadah, className)}>
      <button
        ref={tombol}
        id={id}
        type="button"
        className={styles.pemicu}
        disabled={disabled}
        aria-label={labelTombol}
        aria-haspopup="dialog"
        aria-expanded={terbuka}
        aria-controls={terbuka ? idDialog : undefined}
        aria-describedby={aria['aria-describedby']}
        onClick={() => setTerbuka((b) => !b)}
      >
        <CalendarDays size={16} strokeWidth={1.75} aria-hidden="true" />
        <span className={styles.teks}>{teks}</span>
      </button>
      {terbuka && (
        <>
          <div className={styles.latar} aria-hidden="true" />
          {/* Dialog tidak modal: halaman di belakang tetap ada, fokus dijebak oleh handler Tab di bawah. */}
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
          <div
            ref={dialog}
            id={idDialog}
            role="dialog"
            aria-label={labelDialog}
            tabIndex={-1}
            className={styles.popover}
            onKeyDown={tombolPapan}
          >
            <div className={styles.pegangan} aria-hidden="true" />
            <div ref={kepala} className={styles.kepala}>
              <span className={styles.judul}>{labelDialog}</span>
              <button type="button" className={styles.tutup} aria-label="Tutup" onClick={() => tutup(true)}>
                <X size={18} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
            <KonteksTutup.Provider value={tutup}>{children}</KonteksTutup.Provider>
          </div>
        </>
      )}
    </div>
  );
}
