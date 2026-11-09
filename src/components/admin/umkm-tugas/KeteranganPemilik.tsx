import type { AkunPemilik } from '@/lib/umkm-katalog/types-g5';
import styles from './umkm-tugas.module.css';

// Data akun pemilik hanya dikirim server kepada pemeriksa aktif pada detail tugas.
export default function KeteranganPemilik({ pemilik, judul = 'Akun pemilik' }: {
  pemilik: AkunPemilik; judul?: string;
}) {
  return <section className={styles.bagian} aria-label={judul}>
    <h3>{judul}</h3>
    <dl className={styles.rincian}>
      <dt>Nama akun</dt><dd>{pemilik.nama}</dd>
      <dt>HP</dt><dd>{pemilik.hp ?? 'Tidak ada'}</dd>
      <dt>Email</dt><dd>{pemilik.email ?? 'Tidak ada'}</dd>
    </dl>
  </section>;
}
