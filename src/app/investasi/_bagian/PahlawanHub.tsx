import type { AngkaInvestasiPublik } from '@/lib/data/investasi';
import Tombol from '@/components/ui/Tombol';
import styles from '../investasi.module.css';

const angka = new Intl.NumberFormat('id-ID');

/** Butir angka ringkas dari data publik (tanpa total nilai: mata uang campur). Nilai 0 tidak dipamerkan. */
function butirAngka(a: AngkaInvestasiPublik | null) {
  if (!a) return [];
  return [
    { nilai: a.jumlah_proyek, label: 'proyek siap ditawarkan' },
    { nilai: a.jumlah_dokumen, label: 'dokumen dapat dibaca daring' },
    { nilai: a.jumlah_sektor, label: 'sektor berisi proyek' },
    { nilai: a.jumlah_wilayah, label: 'kabupaten/kota' },
  ].filter(b => b.nilai > 0);
}

type Props = { jumlahProyek: number; angka: AngkaInvestasiPublik | null };

/** Hero penuh lebar: judul putih, dua aksi, dan angka ringkas (disembunyikan bila galat atau semuanya 0). */
export default function PahlawanHub({ jumlahProyek, angka: data }: Props) {
  const butir = butirAngka(data);
  return (
    <section className={styles.pahlawan} aria-labelledby="judul-hub">
      <div className={styles.pahlawanIsi}>
        <div className={styles.pahlawanTeks}>
          <h1 id="judul-hub" className={styles.pahlawanJudul}>Peluang Investasi Lampung</h1>
          <p className={styles.pahlawanIntro}>
            Jelajahi proyek investasi yang siap ditawarkan di Provinsi Lampung, baca dokumen kajiannya, lalu hubungi petugas
            DPMPTSP untuk pendampingan.
          </p>
          {/* Tanpa proyek tidak ada yang bisa dilihat: tombol lompat ikut disembunyikan. */}
          {jumlahProyek > 0 && (
            <div className={styles.pahlawanAksi}>
              <Tombol href="#proyek-ptsp" varian="aksen" ukuran="besar">{`Lihat ${jumlahProyek} proyek`}</Tombol>
              <Tombol href="#jelajah-proyek" varian="sekunder" ukuran="besar">Jelajah Proyek</Tombol>
            </div>
          )}
        </div>
        {butir.length > 0 && (
          <dl className={styles.pahlawanAngka} data-jumlah={butir.length}>
            {butir.map(b => (
              <div key={b.label} className={styles.pahlawanButir}>
                <dt>{b.label}</dt>
                <dd>{angka.format(b.nilai)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  );
}
