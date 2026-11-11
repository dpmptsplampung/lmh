'use client';

// Dialog formulir aksesibel untuk aksi antrean (alihkan, kembalikan ke FO, selesai eskalasi). Kerangkanya satu
// cangkang dengan semua modal (KerangkaModal): role=dialog + aria-modal, judul/deskripsi terhubung, Escape menutup
// (kecuali saat mengirim), jebak fokus, fokus kembali ke pemicu, gulir halaman terkunci. Di sini hanya perakitan:
// badan dari pemanggil, galat tingkat formulir di role=alert, dan kaki Batal/Kirim.
import { useId, type FormEvent, type ReactNode } from 'react';
import KerangkaModal from '@/components/ui/KerangkaModal';
import Tombol from '@/components/ui/Tombol';
import styles from './FoDialog.module.css';

interface Props {
  judul: ReactNode;
  deskripsi?: ReactNode;
  /** Teks tombol kirim; saat `mengirim` tampil "Memproses…". */
  labelKirim: string;
  mengirim: boolean;
  /** Tombol kirim dinonaktifkan tanpa mengirim (mis. data pilihan belum siap). */
  kirimNonaktif?: boolean;
  /** Galat tingkat formulir (hasil RPC); id dikirim ke children lewat render-prop agar bisa dirujuk aria-describedby. */
  galat: string | null;
  onClose: () => void;
  onSubmit: () => void | Promise<void>;
  maxWidth?: number;
  children: (ids: { galat: string }) => ReactNode;
}

export default function FormDialog({
  judul, deskripsi, labelKirim, mengirim, kirimNonaktif, galat, onClose, onSubmit, maxWidth = 520, children,
}: Props) {
  const idGalat = `${useId()}-galat`;

  const kirim = (e: FormEvent) => {
    e.preventDefault();
    if (mengirim) return;
    void onSubmit();
  };

  return (
    <KerangkaModal
      terbuka
      onTutup={onClose}
      judul={<span className={styles.judulIkon}>{judul}</span>}
      deskripsi={deskripsi}
      dikunci={mengirim}
      varian="dialog"
      labelTutup="Tutup"
      lebarMaks={maxWidth}
      onKirim={kirim}
      kaki={
        <>
          <Tombol varian="hantu" ukuran="kecil" onClick={onClose} disabled={mengirim}>
            Batal
          </Tombol>
          <Tombol type="submit" ukuran="kecil" disabled={mengirim || kirimNonaktif} memuat={mengirim}>
            {mengirim ? 'Memproses…' : labelKirim}
          </Tombol>
        </>
      }
    >
      {children({ galat: idGalat })}
      {galat && (
        <p id={idGalat} role="alert" className={styles.galat}>
          {galat}
        </p>
      )}
    </KerangkaModal>
  );
}
