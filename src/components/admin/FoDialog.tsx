'use client';

// Dialog modal aksesibel untuk halaman Front Office (eskalasi, tolak reservasi, aksi chat). Kerangkanya satu cangkang
// dengan semua modal (KerangkaModal): role="dialog" + aria-modal, judul/deskripsi terhubung, Escape (kecuali `dikunci`),
// jebak fokus, fokus kembali ke pemicu, gulir halaman terkunci. Klik latar TIDAK menutup (mencegah isian hilang tak sengaja).
import KerangkaModal from '@/components/ui/KerangkaModal';

interface Props {
  judul: string;
  deskripsi?: React.ReactNode;
  onClose: () => void;
  /** true = request berjalan: Escape dan tombol tutup dinonaktifkan. */
  dikunci?: boolean;
  /** Dipasang pada <form> yang membungkus isi dan footer, agar tombol submit di footer berfungsi. */
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
  /** Isi (badan) dialog. */
  children: React.ReactNode;
  /** Tombol aksi di footer. */
  footer: React.ReactNode;
}

export default function FoDialog({ judul, deskripsi, onClose, dikunci = false, onSubmit, children, footer }: Props) {
  return (
    <KerangkaModal
      terbuka
      onTutup={onClose}
      judul={judul}
      deskripsi={deskripsi}
      dikunci={dikunci}
      varian="dialog"
      lebarMaks={520}
      onKirim={onSubmit ?? ((e) => e.preventDefault())}
      kaki={footer}
    >
      {children}
    </KerangkaModal>
  );
}
