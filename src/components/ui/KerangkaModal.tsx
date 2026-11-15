'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, type FormEvent, type ReactNode } from 'react';
import { useDialogFokus } from '@/components/admin/useDialogFokus';
import { cn } from '@/lib/utils';
import styles from './KerangkaModal.module.css';

export interface KerangkaModalProps {
  terbuka: boolean;
  onTutup: () => void;
  judul: ReactNode;
  deskripsi?: ReactNode;
  kaki?: ReactNode;
  /** Lencana di baris yang sama dengan judul. Di luar <h2> supaya nama aksesibel dialog tidak ikut berisi teksnya. */
  lencanaJudul?: ReactNode;
  /** Blok tambahan di kepala, sesudah `deskripsi` (mis. baris meta, peringatan role="status"). */
  tambahanKepala?: ReactNode;
  /** Slot antara kepala dan badan, di luar area gulir (mis. bilah langkah). */
  bawahKepala?: ReactNode;
  /** Slot antara badan dan kaki (mis. panel konfirmasi tutup). */
  atasKaki?: ReactNode;
  /**
   * Handler Escape terpisah. Bawaan: Esc memanggil `onTutup`. Tombol Tutup dan klik latar tetap memanggil `onTutup`.
   */
  onEscape?: () => void;
  /** Esc diabaikan bila true. Bawaan mengikuti `dikunci`; beri nilai sendiri bila Esc dan tombol Tutup dikunci berbeda. */
  escapeDikunci?: boolean;
  /** true = sedang mengirim: Esc, tombol tutup, dan klik latar diabaikan. */
  dikunci?: boolean;
  /** Varian dialog di layar <= 640px memenuhi layar (tanpa tepi dan radius), untuk formulir bertahap yang panjang. */
  penuhDiHp?: boolean;
  /** Klik latar menutup. Bawaan false agar isian tidak hilang tak sengaja. */
  tutupDenganLatar?: boolean;
  varian: 'dialog' | 'samping';
  lebar?: 'sedang' | 'lebar';
  className?: string;
  /** Peran ARIA kotak. Bawaan 'dialog'; konfirmasi tindakan memakai 'alertdialog'. */
  peran?: 'dialog' | 'alertdialog';
  /** Nama aksesibel tombol Tutup di kepala. */
  labelTutup?: string;
  /** Lebar maksimum kotak dalam px; menggantikan lebar bawaan varian. */
  lebarMaks?: number;
  /**
   * Dialog formulir: badan dan kaki dibungkus satu <form noValidate>, jadi tombol type="submit" di `kaki` ikut
   * mengirim isian di `children`. Form berada DI DALAM elemen role="dialog" (kepala di luar form).
   */
  onKirim?: (e: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}

// Kerangka bersama Dialog dan PanelSamping. Tanpa portal: tetap berada di dalam pembungkus tema.
// Fokus, Escape, dan pengembalian fokus lewat useDialogFokus (perilaku yang sudah ada, tidak diubah).
export default function KerangkaModal({
  terbuka,
  onTutup,
  judul,
  deskripsi,
  kaki,
  lencanaJudul,
  tambahanKepala,
  bawahKepala,
  atasKaki,
  onEscape,
  escapeDikunci,
  dikunci = false,
  tutupDenganLatar = false,
  penuhDiHp = false,
  varian,
  lebar = 'sedang',
  className,
  peran = 'dialog',
  labelTutup = 'Tutup dialog',
  lebarMaks,
  onKirim,
  children,
}: KerangkaModalProps) {
  const wadah = useRef<HTMLDivElement>(null);
  const latar = useRef<HTMLDivElement>(null);
  const idDasar = useId();
  const idJudul = `${idDasar}-judul`;
  const idDesk = `${idDasar}-desk`;

  useDialogFokus(terbuka, wadah, () => {
    if (escapeDikunci ?? dikunci) return;
    (onEscape ?? onTutup)();
  });

  // Kunci gulir halaman selama terbuka; kembalikan nilai sebelumnya (bisa bertumpuk dengan laci).
  useEffect(() => {
    if (!terbuka) return;
    const sebelumnya = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = sebelumnya;
    };
  }, [terbuka]);

  // Klik latar (bukan isi) menutup bila diizinkan. Listener asli: latar bukan kontrol, hanya kenyamanan pointer;
  // jalur papan ketik tetap Esc dan tombol Tutup.
  useEffect(() => {
    const el = latar.current;
    if (!terbuka || !tutupDenganLatar || !el) return;
    const klik = (e: MouseEvent) => {
      if (e.target === el && !dikunci) onTutup();
    };
    el.addEventListener('mousedown', klik);
    return () => el.removeEventListener('mousedown', klik);
  }, [terbuka, tutupDenganLatar, dikunci, onTutup]);

  if (!terbuka) return null;

  const isi = (
    <>
      <div className={styles.badan}>{children}</div>
      {atasKaki}
      {kaki && <footer className={styles.kaki}>{kaki}</footer>}
    </>
  );

  return (
    <div ref={latar} className={cn(styles.latar, varian === 'samping' && styles.latarSamping, penuhDiHp && styles.latarPenuhHp)}>
      <div
        ref={wadah}
        role={peran}
        aria-modal="true"
        aria-labelledby={idJudul}
        aria-describedby={deskripsi ? idDesk : undefined}
        tabIndex={-1}
        style={lebarMaks ? { maxWidth: lebarMaks } : undefined}
        className={cn(
          styles.kotak,
          varian === 'dialog' ? styles.dialog : cn(styles.samping, lebar === 'lebar' ? styles.sampingLebar : styles.sampingSedang),
          penuhDiHp && styles.kotakPenuhHp,
          className,
        )}
      >
        <header className={styles.kepala}>
          <div className={styles.judulWadah}>
            {lencanaJudul ? (
              <div className={styles.judulBaris}>
                <h2 id={idJudul} className={styles.judul}>
                  {judul}
                </h2>
                {lencanaJudul}
              </div>
            ) : (
              <h2 id={idJudul} className={styles.judul}>
                {judul}
              </h2>
            )}
            {deskripsi && (
              <p id={idDesk} className={styles.deskripsi}>
                {deskripsi}
              </p>
            )}
            {tambahanKepala}
          </div>
          <button type="button" className={styles.tutup} onClick={onTutup} disabled={dikunci} aria-label={labelTutup}>
            <X size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </header>
        {bawahKepala}
        {onKirim ? (
          <form noValidate onSubmit={onKirim} className={styles.isian}>
            {isi}
          </form>
        ) : (
          isi
        )}
      </div>
    </div>
  );
}
