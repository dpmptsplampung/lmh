'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { Clock, CircleCheck, LinkIcon } from 'lucide-react';
import styles from './survei.module.css';

export type StatusPesanSurvei = 'kedaluwarsa' | 'sudah_diisi' | 'tidak_valid';

// Pesan ramah untuk pengunjung (spec 7.1): tanpa istilah teknis dan tanpa kata "token".
const PESAN: Record<StatusPesanSurvei, { judul: string; isi: string; Ikon: typeof Clock }> = {
  kedaluwarsa: {
    judul: 'Waktu pengisian sudah berakhir',
    isi: 'Survei ini hanya dapat diisi dalam 32 jam setelah layanan selesai, sehingga tautannya kini tidak berlaku lagi. Terima kasih atas kunjungan Anda.',
    Ikon: Clock,
  },
  sudah_diisi: {
    judul: 'Terima kasih, survei ini sudah Anda isi',
    isi: 'Jawaban untuk kunjungan ini sudah kami terima, jadi tidak perlu diisi lagi.',
    Ikon: CircleCheck,
  },
  tidak_valid: {
    judul: 'Tautan survei tidak dikenali',
    isi: 'Tautan atau kode QR ini tidak dapat dipakai. Silakan pindai ulang kode QR yang ditampilkan petugas kami.',
    Ikon: LinkIcon,
  },
};

export default function PesanStatusSurvei({ status }: { status: StatusPesanSurvei }) {
  const { judul, isi, Ikon } = PESAN[status];
  const judulRef = useRef<HTMLHeadingElement>(null);

  // Isi halaman berganti (dari pemuatan atau dari wizard): fokus ke judul agar pembaca layar langsung membacakannya.
  useEffect(() => {
    judulRef.current?.focus();
  }, []);

  return (
    <section className={styles.pesanStatus} aria-labelledby="judul-pesan-status">
      <Ikon size={40} className={styles.ikonStatus} aria-hidden="true" />
      <h2 id="judul-pesan-status" ref={judulRef} tabIndex={-1} className={styles.judulPesan}>
        {judul}
      </h2>
      <p className={styles.isiPesan}>{isi}</p>
      <Link href="/" className={`btn btn--secondary ${styles.tombolNav}`}>
        Ke beranda
      </Link>
    </section>
  );
}
