'use client';

// Sel Status pada tabel antrean: lencana status + (saat dilayani) siapa yang melayani. Hanya tampilan dari props.
import Lencana from '@/components/ui/Lencana';
import type { ProfilPetugasAntrean, TiketBaris } from '@/lib/data/antrean';
import { bolehSelesaikanTiket } from '@/lib/pelayanan';
import { NADA_STATUS, labelStatus, namaPelayanDari } from '../_logika/turunan';
import styles from '../antrian.module.css';

export interface SelStatusProps {
  tiket: TiketBaris;
  pengguna: ProfilPetugasAntrean | null;
}

export default function SelStatus({ tiket, pengguna }: SelStatusProps) {
  const milikSaya = bolehSelesaikanTiket(pengguna, tiket);
  const pelayanNama = namaPelayanDari(tiket);
  return (
    <>
      <Lencana nada={NADA_STATUS[tiket.status] ?? 'netral'}>{labelStatus(tiket.status)}</Lencana>
      {tiket.status === 'dilayani' && (
        <small className={styles.sekunder}>{milikSaya ? 'oleh Anda' : `oleh ${pelayanNama ?? 'petugas lain'}`}</small>
      )}
    </>
  );
}
