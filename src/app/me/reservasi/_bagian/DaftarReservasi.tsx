'use client';

// Kartu "Reservasi Saya" (kontrak §6.6): baris kunjungan milik pengunjung, QR untuk yang masih terjadwal. Tanpa query.
// Daftar dibatasi 30 terbaru oleh lib/data/reservasi.ts, jadi tidak berpaginasi (sama dengan halaman lama).
import { CalendarCheck } from 'lucide-react';
import ErrorRetry from '@/components/ErrorRetry';
import Kartu from '@/components/ui/Kartu';
import StatusKosong from '@/components/ui/StatusKosong';
import type { LayananReservasi } from '@/lib/data/reservasi';
import type { ReservasiKunjungan } from '@/lib/reservasi';
import { namaLayananSaran } from '../_logika/tampilanReservasi';
import KartuReservasi from './KartuReservasi';
import styles from '../reservasi.module.css';

interface DaftarReservasiProps {
  daftar: ReservasiKunjungan[];
  gagal: boolean;
  /** Untuk nama layanan dari id saran. */
  layanan: ReadonlyArray<Pick<LayananReservasi, 'id' | 'nama'>>;
  infoBatal: string;
  galatBatal: string;
  konfirmasiBatal: string | null;
  membatalkan: string | null;
  onMuatUlang: () => void;
  onMintaBatal: (id: string) => void;
  onBatalkan: (id: string) => void;
  onTutupKonfirmasi: () => void;
}

export default function DaftarReservasi({
  daftar,
  gagal,
  layanan,
  infoBatal,
  galatBatal,
  konfirmasiBatal,
  membatalkan,
  onMuatUlang,
  onMintaBatal,
  onBatalkan,
  onTutupKonfirmasi,
}: DaftarReservasiProps) {
  return (
    <Kartu className={styles.daftarKartu} judul="Reservasi Saya">
      <div role="status" aria-live="polite">
        {infoBatal && <p className={styles.daftarInfo}>{infoBatal}</p>}
      </div>
      {galatBatal && (
        <p className={styles.galatForm} role="alert">
          {galatBatal}
        </p>
      )}
      {gagal ? (
        <ErrorRetry
          judul="Daftar reservasi belum termuat"
          pesan="Daftar reservasi Anda tidak dapat dimuat saat ini."
          onRetry={onMuatUlang}
        />
      ) : daftar.length === 0 ? (
        <StatusKosong
          ikon={CalendarCheck}
          judul="Belum ada reservasi."
          isi="Reservasi yang Anda buat akan muncul di sini beserta QR code-nya."
        />
      ) : (
        <ul className={styles.daftarList}>
          {daftar.map((r) => (
            <KartuReservasi
              key={r.id}
              reservasi={r}
              judul={
                r.tujuan === 'bertemu_seseorang'
                  ? `Bertemu: ${r.nama_yang_ditemui ?? '-'}`
                  : namaLayananSaran(r.layanan_saran_id, layanan)
              }
              konfirmasiBatal={konfirmasiBatal}
              membatalkan={membatalkan}
              onMintaBatal={onMintaBatal}
              onBatalkan={onBatalkan}
              onTutupKonfirmasi={onTutupKonfirmasi}
            />
          ))}
        </ul>
      )}
    </Kartu>
  );
}
