'use client';

// Kerangka dialog modal aksesibel untuk halaman Front Office (eskalasi, tolak reservasi).
// role="dialog" + aria-modal, judul/deskripsi terhubung (aria-labelledby/-describedby), Escape, focus trap,
// dan pengembalian fokus lewat useDialogA11y. Klik latar TIDAK menutup (mencegah isian hilang tak sengaja).
import { useId, useRef } from 'react';
import { X } from 'lucide-react';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import styles from './FoDialog.module.css';

interface Props {
  judul: string;
  deskripsi?: React.ReactNode;
  onClose: () => void;
  /** true = request berjalan: Escape dan tombol tutup dinonaktifkan. */
  dikunci?: boolean;
  /** Dirender di dalam <form>; `onSubmit` dipasang di sini agar tombol submit di footer berfungsi. */
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
  /** Isi (badan) dialog. */
  children: React.ReactNode;
  /** Tombol aksi di footer. */
  footer: React.ReactNode;
}

export default function FoDialog({ judul, deskripsi, onClose, dikunci = false, onSubmit, children, footer }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const idDasar = useId();
  const idJudul = `${idDasar}-judul`;
  const idDesk = `${idDasar}-desk`;

  useDialogA11y({ aktif: true, dialogRef, onClose, dikunci });

  return (
    <div className={styles.overlay}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idJudul}
        aria-describedby={deskripsi ? idDesk : undefined}
        tabIndex={-1}
        className={styles.dialog}
      >
        <form onSubmit={onSubmit} noValidate>
          <div className={styles.header}>
            <div>
              <h2 id={idJudul} className={styles.judul}>{judul}</h2>
              {deskripsi && <p id={idDesk} className={styles.deskripsi}>{deskripsi}</p>}
            </div>
            <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} disabled={dikunci} aria-label="Tutup dialog">
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <div className={styles.body}>{children}</div>
          <div className={styles.footer}>{footer}</div>
        </form>
      </div>
    </div>
  );
}
