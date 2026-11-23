'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, type FormEvent, type ReactNode, type MouseEvent as MouseEventReact } from 'react';
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

// Kerangka bersama Dialog dan PanelSamping. Kotaknya elemen <dialog> asli yang dibuka dengan showModal(): top layer
// (tanpa z-index), latar inert untuk pembaca layar, ::backdrop sebagai lapisan gelap. Tanpa portal: tetap berada di
// dalam pembungkus tema, dan top layer tidak memutus pewarisan custom property dari leluhur DOM.
// Fokus awal, jebak Tab, Escape, dan pengembalian fokus tetap lewat useDialogFokus (diuji di jsdom, yang tidak
// mengimplementasikan perilaku bawaan <dialog>); Escape asli (`cancel`, mis. gestur kembali Android) ditangani juga.
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
  const wadah = useRef<HTMLDialogElement>(null);
  const idDasar = useId();
  const idJudul = `${idDasar}-judul`;
  const idDesk = `${idDasar}-desk`;

  const mintaTutup = () => {
    if (escapeDikunci ?? dikunci) return;
    (onEscape ?? onTutup)();
  };
  const mintaTutupRef = useRef(mintaTutup);
  useEffect(() => {
    mintaTutupRef.current = mintaTutup;
  });

  // useDialogFokus membuka <dialog> dengan showModal() (setelah mencatat pemicu fokus) lalu memilih fokus awal.
  useDialogFokus(terbuka, wadah, () => mintaTutupRef.current());

  // Kunci gulir halaman selama terbuka; kembalikan nilai sebelumnya (bisa bertumpuk dengan laci).
  useEffect(() => {
    if (!terbuka) return;
    const sebelumnya = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = sebelumnya;
    };
  }, [terbuka]);

  // Klik latar (::backdrop) menjatuhkan target ke elemen <dialog> itu sendiri; bedakan dari klik di dalam kotak lewat
  // koordinat. Listener pointer hanya kenyamanan: jalur papan ketik tetap Esc dan tombol Tutup.
  const klikLatar = (e: MouseEventReact<HTMLDialogElement>) => {
    if (!tutupDenganLatar || dikunci || e.target !== e.currentTarget) return;
    const r = e.currentTarget.getBoundingClientRect();
    const diLuar = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    if (diLuar) onTutup();
  };

  if (!terbuka) return null;

  const isi = (
    <>
      <div className={styles.badan}>{children}</div>
      {atasKaki}
      {kaki && <footer className={styles.kaki}>{kaki}</footer>}
    </>
  );

  return (
    // Tutup lewat `cancel` (Esc asli, gestur kembali): selalu dicegah, penutupan diputuskan state pemanggil. Bila peramban
    // menutup paksa (penolakan cancel berulang), `close` membuka ulang selama komponen masih terpasang.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- <dialog>: penangkap klik latar (::backdrop) dan cancel
    <dialog
      ref={wadah}
      role={peran === 'alertdialog' ? 'alertdialog' : undefined}
      aria-modal="true"
      aria-labelledby={idJudul}
      aria-describedby={deskripsi ? idDesk : undefined}
      tabIndex={-1}
      style={lebarMaks ? { maxWidth: lebarMaks } : undefined}
      onMouseDown={klikLatar}
      onCancel={(e) => {
        e.preventDefault();
        mintaTutupRef.current();
      }}
      onClose={(e) => {
        const el = e.currentTarget;
        if (el.isConnected && !el.open && typeof el.showModal === 'function') el.showModal();
      }}
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
    </dialog>
  );
}
