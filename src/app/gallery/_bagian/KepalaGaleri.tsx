import Link from 'next/link';
import styles from '../gallery.module.css';

export default function KepalaGaleri() {
  return (
    <header className={styles.kepala}>
      <div className={styles.kepalaIsi}>
        <nav aria-label="Remah roti" className={styles.remah}>
          <ol>
            <li><Link href="/investasi">Investasi</Link></li>
            <li aria-current="page">Investment Gallery</li>
          </ol>
        </nav>
        <h1 className={styles.judul}>Investment Gallery</h1>
        <p className={styles.intro}>
          Peta Potensi, kajian, dan profil proyek investasi Provinsi Lampung dalam satu tempat. Seluruh dokumen dibaca daring
          dan dilindungi hak cipta (hanya lihat, tanpa unduh).
        </p>
      </div>
    </header>
  );
}
