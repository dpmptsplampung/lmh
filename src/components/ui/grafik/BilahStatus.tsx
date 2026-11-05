import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { NadaLencana } from '../Lencana';
import styles from './BilahStatus.module.css';

export interface ItemBilahStatus {
  kunci: string;
  nada: NadaLencana;
  label: ReactNode;
}

export interface BilahStatusProps {
  item: ItemBilahStatus[];
  /** Nama daftar untuk pembaca layar. */
  label?: string;
  className?: string;
}

// Bilah status hari ini: deretan titik berwarna + kalimat ("Hari libur", "3 dari 8 layanan buka", "Migrasi X belum diterapkan").
// Tidak diumumkan otomatis (bukan live region) agar tidak mengganggu pembaca layar.
export default function BilahStatus({ item, label = 'Status hari ini', className }: BilahStatusProps) {
  if (item.length === 0) return null;
  return (
    <ul className={cn(styles.bilah, className)} aria-label={label}>
      {item.map((it) => (
        <li key={it.kunci} className={cn(styles.item, styles[it.nada])}>
          <span className={styles.titik} aria-hidden="true" />
          {it.label}
        </li>
      ))}
    </ul>
  );
}
