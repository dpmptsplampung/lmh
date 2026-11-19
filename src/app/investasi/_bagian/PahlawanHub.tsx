import Tombol from '@/components/ui/Tombol';
import styles from '../investasi.module.css';

export default function PahlawanHub({ jumlahProyek }: { jumlahProyek: number }) {
  return (
    <section className={styles.pahlawan} aria-labelledby="judul-hub">
      <div className={styles.pahlawanIsi}>
        <h1 id="judul-hub" className={styles.pahlawanJudul}>Peluang Investasi Lampung</h1>
        <p className={styles.pahlawanIntro}>
          Jelajahi proyek investasi yang siap ditawarkan di Provinsi Lampung, lihat dokumen kajiannya, lalu hubungi petugas
          DPMPTSP untuk pendampingan.
        </p>
        <div className={styles.pahlawanAksi}>
          <Tombol href="#proyek-ptsp" varian="aksen" ukuran="besar">
            {jumlahProyek > 0 ? `Lihat ${jumlahProyek} proyek` : 'Lihat proyek'}
          </Tombol>
          <Tombol href="#peta-potensi" varian="sekunder" ukuran="besar">Peta potensi</Tombol>
        </div>
      </div>
    </section>
  );
}
