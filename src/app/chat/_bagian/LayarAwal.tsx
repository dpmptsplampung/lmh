'use client';

// Layar awal /chat sebelum percakapan dibuka: skeleton pemuatan, daftar percakapan, atau formulir percakapan baru (nama +
// pilih layanan + persetujuan, atau ajakan masuk Google). Hanya tampilan dari props.
import { AlertCircle, ArrowLeft, MessageSquare } from 'lucide-react';
import Skeleton from '@/components/ui/Skeleton';
import Tombol from '@/components/ui/Tombol';
import type { PercakapanRingkas } from '@/lib/chat/percakapan';
import styles from '../chat.module.css';
import DaftarPercakapan from '../DaftarPercakapan';
import { TEKS_OFFLINE } from '../_logika/turunan';
import FormulirBaru, { type FormulirBaruProps } from './FormulirBaru';
import { PII_DISCLAIMER } from './teks';

export interface LayarAwalProps {
  tampilan: 'memuat' | 'daftar' | 'baru';
  daftar: {
    items: PercakapanRingkas[];
    dibaca: Record<string, string | null>;
    memuat: boolean;
    galat: boolean;
    onCobaLagi: () => void;
    onBuka: (p: PercakapanRingkas) => void;
    onBaru: () => void;
  };
  /** Layar percakapan baru. */
  baru: {
    galatSetup: string | null;
    onKembaliKeDaftar: () => void;
    formulir: FormulirBaruProps;
  };
}

export default function LayarAwal({ tampilan, daftar, baru }: LayarAwalProps) {
  if (tampilan === 'memuat') {
    return (
      <div role="status" className={styles.memuat}>
        <Skeleton bentuk="baris" jumlah={3} label="Memuat percakapan..." />
      </div>
    );
  }

  if (tampilan === 'daftar') {
    return (
      <DaftarPercakapan
        items={daftar.items}
        dibaca={daftar.dibaca}
        onBuka={daftar.onBuka}
        onBaru={daftar.onBaru}
        memuat={daftar.memuat}
        galat={daftar.galat}
        onCobaLagi={daftar.onCobaLagi}
      />
    );
  }

  /* Setup / Formulir Percakapan Baru */
  return (
    <div className={styles.setupState}>
      {daftar.items.length > 0 && (
        <Tombol
          varian="sekunder"
          ukuran="kecil"
          ikon={ArrowLeft}
          className={styles.kembaliDaftar}
          onClick={baru.onKembaliKeDaftar}
        >
          Daftar percakapan
        </Tombol>
      )}
      <div className={styles.setupKepala}>
        <span className={styles.setupIkon}>
          <MessageSquare size={28} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <h2 className={styles.setupTitle}>Mulai Konsultasi Online</h2>
        <p className={styles.setupDesc}>
          Silakan isi data diri singkat dan pilih layanan tujuan Anda untuk memulai sesi chat dengan petugas atau bot FAQ.
        </p>
        <p className={styles.setupCatatan}>{PII_DISCLAIMER}</p>
      </div>

      {!baru.formulir.daring && (
        <p role="alert" className={styles.galatBaris}>
          <AlertCircle size={16} strokeWidth={1.75} aria-hidden="true" />
          {TEKS_OFFLINE}
        </p>
      )}
      {baru.galatSetup && (
        <p role="alert" className={styles.galatBaris}>
          <AlertCircle size={16} strokeWidth={1.75} aria-hidden="true" />
          {baru.galatSetup}
        </p>
      )}

      <FormulirBaru {...baru.formulir} />
    </div>
  );
}
