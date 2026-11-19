import { FileText } from 'lucide-react';
import type { DokumenRingkas } from '@/lib/data/investasi';
import Lencana from '@/components/ui/Lencana';
import StatusKosong from '@/components/ui/StatusKosong';
import Tombol from '@/components/ui/Tombol';
import styles from '../investasi.module.css';

const MAKS_DOKUMEN_HUB = 6;

/** Cuplikan dokumen investasi aktif (maksimal 6); daftar lengkap dan penampilnya ada di /gallery. */
export default function SeksiDokumen({ daftar }: { daftar: DokumenRingkas[] }) {
  const tampil = daftar.slice(0, MAKS_DOKUMEN_HUB);
  return (
    <section className={styles.seksi} aria-labelledby="judul-dokumen">
      <div className={styles.seksiKepala}>
        <h2 id="judul-dokumen" className={styles.seksiJudul}>Dokumen investasi</h2>
        <p className={styles.seksiIntro}>Profil dan kajian proyek dalam bentuk dokumen. Dokumen dapat dibaca daring (hanya lihat, tanpa unduh).</p>
      </div>
      {tampil.length === 0 ? (
        <StatusKosong ikon={FileText} judul="Belum ada dokumen tersedia" />
      ) : (
        <>
          <ul className={styles.kisiRapat}>
            {tampil.map(d => (
              <li key={d.id} className={styles.dokumenKartu}>
                {d.kategori && <Lencana nada="netral">{d.kategori}</Lencana>}
                <h3 className={styles.dokumenJudul}>{d.judul}</h3>
                {d.deskripsi && <p className={styles.kartuRingkas}>{d.deskripsi}</p>}
                <p className={styles.dokumenMeta}>
                  {d.nilai_investasi && <span>Nilai {d.nilai_investasi}</span>}
                  {d.jumlah_halaman ? <span>{d.jumlah_halaman} halaman</span> : null}
                </p>
              </li>
            ))}
          </ul>
          <div className={styles.seksiAksi}><Tombol href="/gallery" varian="sekunder">Lihat semua dokumen</Tombol></div>
        </>
      )}
    </section>
  );
}
