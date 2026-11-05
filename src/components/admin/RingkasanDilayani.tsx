'use client';

// Ringkasan "dilayani saya / total (persen)" untuk tabel dan rekap tertutup (.tim/akses-fo/KONTRAK.md aturan 4).
// Angka datang dari RPC agregat (ANGKA SAJA); filter yang dipakai sama dengan tabel di bawahnya. `dilayani` null tanpa
// galat = RPC belum ada (migrasi belum diterapkan): tidak merender apa pun, bukan nol palsu.
import { formatDilayani, type Dilayani } from '@/lib/fo/akses-antrean';
import styles from './RingkasanDilayani.module.css';

interface Props {
  dilayani: Dilayani | null;
  memuat?: boolean;
  /** Pesan galat dari pemuat; bila ada, tampil keterangan gagal alih-alih angka. */
  galat?: string | null;
}

export default function RingkasanDilayani({ dilayani, memuat = false, galat = null }: Props) {
  if (galat) {
    return (
      <p role="status" className={`${styles.ringkasan} ${styles.galat}`}>
        Ringkasan dilayani tidak dapat dimuat. Tabel di bawah tetap berlaku.
      </p>
    );
  }
  if (memuat && !dilayani) {
    return (
      <p aria-busy="true" className={`${styles.ringkasan} ${styles.memuat}`}>
        Memuat ringkasan dilayani…
      </p>
    );
  }
  if (!dilayani) return null;
  return (
    <div
      className={styles.ringkasan}
      aria-busy={memuat || undefined}
      title="Pelayanan yang Anda layani dibandingkan seluruh pelayanan pada periode dan filter yang sama"
    >
      <span className={styles.label}>Dilayani saya / total</span>
      <span className={styles.nilai}>{formatDilayani(dilayani)}</span>
    </div>
  );
}
