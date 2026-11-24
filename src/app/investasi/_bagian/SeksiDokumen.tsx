import { FileText } from 'lucide-react';
import type { DokumenPublik } from '@/lib/investasi/dokumen';
import KisiDokumen from '@/components/investasi/KisiDokumen';
import StatusKosong from '@/components/ui/StatusKosong';
import Tombol from '@/components/ui/Tombol';
import styles from '../investasi.module.css';

const MAKS_DOKUMEN_HUB = 6;

/** Cuplikan dokumen investasi aktif (maksimal 6) dengan kartu yang sama seperti /gallery; daftar lengkap ada di /gallery. */
export default function SeksiDokumen({ daftar }: { daftar: DokumenPublik[] }) {
  const tampil = daftar.slice(0, MAKS_DOKUMEN_HUB);
  return (
    <section className={styles.pita} aria-labelledby="judul-dokumen">
      <div className={styles.pitaIsi}>
        <div className={styles.seksiKepalaBaris}>
          <div className={styles.seksiKepala}>
            <h2 id="judul-dokumen" className={styles.seksiJudul}>Investment Gallery</h2>
            <p className={styles.seksiIntro}>Profil dan kajian proyek yang dapat dibaca daring (hanya lihat, tanpa unduh).</p>
          </div>
          {tampil.length > 0 && <Tombol href="/gallery" varian="sekunder">Lihat semua dokumen</Tombol>}
        </div>
        {tampil.length === 0 ? (
          <StatusKosong ikon={FileText} judul="Belum ada dokumen tersedia" />
        ) : (
          <KisiDokumen dokumen={tampil} label="Investment Gallery" />
        )}
      </div>
    </section>
  );
}
