'use client';

import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { BISA_DIFOKUS } from './fokus';
import styles from './Tab.module.css';

export interface ItemTab {
  kunci: string;
  label: string;
  /** Angka kecil di samping label (mis. jumlah menunggu). */
  jumlah?: number;
  nonaktif?: boolean;
}

export interface TabProps {
  tab: ItemTab[];
  aktif: string;
  onGanti: (kunci: string) => void;
  /** Nama daftar tab untuk pembaca layar (wajib). */
  label: string;
  /** Awalan id agar PanelTab bisa dihubungkan. Bawaan: useId. */
  id?: string;
  className?: string;
}

export const idTab = (dasar: string, kunci: string) => `${dasar}-tab-${kunci}`;
export const idPanelTab = (dasar: string, kunci: string) => `${dasar}-panel-${kunci}`;

// Pola ARIA tabs dengan aktivasi otomatis: panah kiri/kanan (berputar), Home, End; roving tabindex.
export default function Tab({ tab, aktif, onGanti, label, id, className }: TabProps) {
  const dasarOtomatis = useId();
  const dasar = id ?? dasarOtomatis;
  const daftar = useRef<HTMLDivElement>(null);

  const pindah = (e: KeyboardEvent<HTMLButtonElement>, indeks: number) => {
    const aktifkan = tab.map((t, i) => ({ t, i })).filter(({ t }) => !t.nonaktif);
    if (aktifkan.length === 0) return;
    const posisi = aktifkan.findIndex(({ i }) => i === indeks);
    let tujuan: number | null = null;
    if (e.key === 'ArrowRight') tujuan = aktifkan[(posisi + 1) % aktifkan.length].i;
    else if (e.key === 'ArrowLeft') tujuan = aktifkan[(posisi - 1 + aktifkan.length) % aktifkan.length].i;
    else if (e.key === 'Home') tujuan = aktifkan[0].i;
    else if (e.key === 'End') tujuan = aktifkan[aktifkan.length - 1].i;
    if (tujuan === null) return;
    e.preventDefault();
    onGanti(tab[tujuan].kunci);
    daftar.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[tujuan]?.focus();
  };

  return (
    <div ref={daftar} role="tablist" aria-label={label} className={cn(styles.daftar, className)}>
      {tab.map((t, i) => {
        const terpilih = t.kunci === aktif;
        return (
          <button
            key={t.kunci}
            type="button"
            role="tab"
            id={idTab(dasar, t.kunci)}
            aria-selected={terpilih}
            aria-controls={idPanelTab(dasar, t.kunci)}
            tabIndex={terpilih ? 0 : -1}
            disabled={t.nonaktif}
            className={cn(styles.tab, terpilih && styles.terpilih)}
            onClick={() => onGanti(t.kunci)}
            onKeyDown={(e) => pindah(e, i)}
          >
            {t.label}
            {t.jumlah !== undefined && <span className={styles.jumlah}>{t.jumlah}</span>}
          </button>
        );
      })}
    </div>
  );
}

export interface PanelTabProps {
  /** Nilai `id` yang sama dengan yang diberikan ke <Tab>. */
  idTab: string;
  kunci: string;
  aktif: string;
  className?: string;
  children: ReactNode;
}

// Panel milik satu tab. Panel yang tidak aktif tidak dirender (isi tidak dimuat).
export function PanelTab({ idTab: dasar, kunci, aktif, className, children }: PanelTabProps) {
  if (kunci !== aktif) return null;
  return (
    <div role="tabpanel" id={idPanelTab(dasar, kunci)} aria-labelledby={idTab(dasar, kunci)} {...BISA_DIFOKUS} className={className}>
      {children}
    </div>
  );
}
