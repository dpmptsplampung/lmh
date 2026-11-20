import KerangkaInvestasi from '@/components/investasi/KerangkaInvestasi';
import Tombol from '@/components/ui/Tombol';
import styles from './investasi.module.css';

/** 404 khusus rute /investasi (dipakai notFound() di detail IPRO): tetap dalam kepala dan kaki investasi. */
export default function InvestasiNotFound() {
  return (
    <KerangkaInvestasi aktif="detail">
      <div className={styles.tidakAda}>
        <p className={styles.tidakAdaKode}>404</p>
        <h1 className={styles.tidakAdaJudul}>Proyek Tidak Ditemukan</h1>
        <p className={styles.tidakAdaIsi}>
          Proyek yang Anda cari tidak tersedia, belum diterbitkan, atau sudah diarsipkan. Lihat daftar proyek investasi
          yang sedang ditawarkan.
        </p>
        <div className={styles.tidakAdaAksi}>
          <Tombol href="/investasi" ukuran="besar">Lihat semua proyek</Tombol>
          <Tombol href="/" ukuran="besar" varian="sekunder">Kembali ke Beranda</Tombol>
        </div>
      </div>
    </KerangkaInvestasi>
  );
}
