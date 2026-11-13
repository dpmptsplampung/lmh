'use client';

// FAQ Cepat di dalam daftar pesan: chip pertanyaan, atau galat + Coba lagi bila FAQ gagal dimuat (S14: bukan daftar kosong
// senyap). Tidak merender apa pun bila tidak aktif atau FAQ kosong.
import Galat from '@/components/ui/Galat';
import type { FaqChat } from '@/lib/data/chat-pengunjung';
import styles from '../chat.module.css';

export interface FaqCepatProps {
  /** Bot menjawab dan sesi ada (tombol FAQ hanya untuk mode bot). */
  aktif: boolean;
  galat: boolean;
  memuat: boolean;
  daftar: readonly FaqChat[];
  onCobaLagi: () => void;
  onPilih: (pertanyaan: string) => void;
}

export default function FaqCepat({ aktif, galat, memuat, daftar, onCobaLagi, onPilih }: FaqCepatProps) {
  if (!aktif) return null;
  if (galat) {
    return (
      <div className={styles.faqError}>
        <Galat
          judul="FAQ belum dapat dimuat"
          pesan="Pertanyaan cepat tidak tersedia untuk sementara. Anda tetap dapat mengetik pertanyaan langsung."
          onRetry={onCobaLagi}
          memuat={memuat}
        />
      </div>
    );
  }
  if (daftar.length === 0) return null;
  return (
    <div className={styles.quickFaqSection}>
      <span className={styles.quickFaqTitle}>FAQ Cepat:</span>
      <div className={styles.quickFaqGrid}>
        {daftar.map((f) => (
          <button key={f.id} type="button" className={styles.quickFaqBtn} onClick={() => onPilih(f.pertanyaan)}>
            {f.pertanyaan}
          </button>
        ))}
      </div>
    </div>
  );
}
