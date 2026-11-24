'use client';

import KerangkaInvestasi from '@/components/investasi/KerangkaInvestasi';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import Tombol from '@/components/ui/Tombol';
import styles from './gallery.module.css';

/** Galat tak terduga: tetap dalam kerangka investasi dengan jalan keluar yang jelas. */
export default function GalatGallery({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <KerangkaInvestasi aktif="dokumen">
      <div className={styles.isi}>
        <h1 className={styles.daftarJudul}>Investment Gallery belum dapat dimuat</h1>
        <CatatanKeadaan jenis="galat" aksi={<Tombol onClick={reset}>Coba lagi</Tombol>}>
          Terjadi gangguan sesaat. Coba lagi, atau kembali ke halaman peluang investasi.
        </CatatanKeadaan>
      </div>
    </KerangkaInvestasi>
  );
}
