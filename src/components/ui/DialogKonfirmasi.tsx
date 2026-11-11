'use client';

import type { ReactNode } from 'react';
import Tombol from './Tombol';
import KerangkaModal from './KerangkaModal';

export interface DialogKonfirmasiProps {
  terbuka: boolean;
  judul: string;
  deskripsi?: ReactNode;
  labelSetuju?: string;
  labelBatal?: string;
  /** Tindakan merusak/tak bisa dibatalkan: tombol setuju bergaya bahaya. */
  berbahaya?: boolean;
  /** Tindakan sedang berjalan: semua kontrol, Esc, dan klik latar terkunci. */
  memuat?: boolean;
  onSetuju: () => void;
  onBatal: () => void;
}

// Pengganti window.confirm. role="alertdialog"; fokus awal di Batal (pilihan aman bila Enter tertekan),
// Esc = onBatal, jebak fokus dan pengembalian fokus lewat useDialogFokus (dibawa KerangkaModal).
export default function DialogKonfirmasi({
  terbuka,
  judul,
  deskripsi,
  labelSetuju = 'Ya',
  labelBatal = 'Batal',
  berbahaya = false,
  memuat = false,
  onSetuju,
  onBatal,
}: DialogKonfirmasiProps) {
  return (
    <KerangkaModal
      terbuka={terbuka}
      onTutup={onBatal}
      judul={judul}
      deskripsi={deskripsi}
      dikunci={memuat}
      varian="dialog"
      peran="alertdialog"
      kaki={
        <>
          <Tombol type="button" varian="sekunder" data-autofocus="" onClick={onBatal} disabled={memuat}>
            {labelBatal}
          </Tombol>
          <Tombol type="button" varian={berbahaya ? 'bahaya' : 'utama'} onClick={onSetuju} memuat={memuat}>
            {labelSetuju}
          </Tombol>
        </>
      }
    >
      {null}
    </KerangkaModal>
  );
}
