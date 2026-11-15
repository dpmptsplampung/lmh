'use client';

import type { ReactNode } from 'react';
import KerangkaModal from './KerangkaModal';

export interface DialogProps {
  terbuka: boolean;
  onTutup: () => void;
  judul: ReactNode;
  deskripsi?: ReactNode;
  /** Baris tombol aksi di dasar dialog. */
  kaki?: ReactNode;
  /** Sedang mengirim: Esc, tombol tutup, dan klik latar diabaikan. */
  dikunci?: boolean;
  tutupDenganLatar?: boolean;
  /** Lebar maksimum kotak dalam px (bawaan 560); untuk isi lebar seperti penampil dokumen. */
  lebarMaks?: number;
  children: ReactNode;
}

// Dialog modal (maks 560px). Memakai useDialogFokus: jebak fokus, Esc, fokus kembali ke pemicu.
// Dirender hanya saat `terbuka`, di tempat (tanpa portal) supaya ikut tema pembungkusnya.
export default function Dialog(props: DialogProps) {
  return <KerangkaModal {...props} varian="dialog" />;
}
