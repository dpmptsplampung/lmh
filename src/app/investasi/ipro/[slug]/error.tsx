'use client';

import Link from 'next/link';
import KerangkaInvestasi from '@/components/investasi/KerangkaInvestasi';
import Tombol from '@/components/ui/Tombol';
import styles from '../../investasi.module.css';

/** Galat sesaat di detail proyek: tetap dalam kepala dan kaki investasi (satu landmark main dari root layout). */
export default function GalatDetailIpro({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <KerangkaInvestasi aktif="detail">
      <div className={styles.tidakAda}>
        <h1 className={styles.tidakAdaJudul}>Proyek belum dapat dimuat</h1>
        <p className={styles.tidakAdaIsi}>
          Terjadi gangguan sesaat saat memuat data proyek. Coba lagi, atau kembali ke daftar <Link href="/investasi">peluang investasi</Link>.
        </p>
        <div className={styles.tidakAdaAksi}>
          <Tombol onClick={reset}>Coba lagi</Tombol>
        </div>
      </div>
    </KerangkaInvestasi>
  );
}
