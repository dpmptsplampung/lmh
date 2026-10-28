'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { CircleCheck } from 'lucide-react';
import styles from './survei.module.css';

interface AkhirSurveiProps {
  /** Dipanggil saat "Selesai" ditekan. Bawaan: kembali ke beranda (tab dari pemindai QR umumnya tidak boleh ditutup skrip). */
  onSelesai?: () => void;
}

// Layar akhir Fase A: ucapan terima kasih dan satu tombol Selesai. Tombol saran dan pengaduan ditambahkan di Fase B.
export default function AkhirSurvei({ onSelesai }: AkhirSurveiProps) {
  const router = useRouter();
  const judulRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    judulRef.current?.focus();
  }, []);

  return (
    <section className={styles.akhir} aria-labelledby="judul-akhir-survei">
      <div className={styles.lingkaranAkhir} aria-hidden="true">
        <CircleCheck size={56} className={styles.ikonAkhir} />
      </div>
      <h2 id="judul-akhir-survei" ref={judulRef} tabIndex={-1} className={styles.judulPesan}>
        Terima kasih, jawaban Anda sudah terkirim.
      </h2>
      <p className={styles.isiPesan}>
        Penilaian Anda membantu DPMPTSP Provinsi Lampung menjaga pelayanan yang bersih, cepat, dan ramah.
      </p>
      <button
        type="button"
        className={`btn btn--primary ${styles.tombolNav}`}
        onClick={onSelesai ?? (() => router.replace('/'))}
      >
        Selesai
      </button>
    </section>
  );
}
