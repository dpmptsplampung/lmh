import Tombol from '@/components/ui/Tombol';
import styles from '../investasi.module.css';

export default function AjakanHub() {
  return (
    <section className={styles.ajakan} aria-labelledby="judul-ajakan">
      <h2 id="judul-ajakan" className={styles.ajakanJudul}>Tertarik berinvestasi di Lampung?</h2>
      <p>Tim DPMPTSP Provinsi Lampung siap membantu informasi dan pendampingan. Buka halaman proyek untuk menghubungi petugas, atau mulai dari live chat.</p>
      <Tombol href="/chat" varian="aksen">Konsultasi lewat live chat</Tombol>
    </section>
  );
}
