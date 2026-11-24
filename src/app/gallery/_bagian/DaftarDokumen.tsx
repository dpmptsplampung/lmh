import { FileSearch, FileText } from 'lucide-react';
import type { DokumenPublik } from '@/lib/investasi/dokumen';
import KisiDokumen from '@/components/investasi/KisiDokumen';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import StatusKosong from '@/components/ui/StatusKosong';
import Tombol from '@/components/ui/Tombol';
import styles from '../gallery.module.css';

type Props = { dokumen: DokumenPublik[]; galat: boolean; adaBerikutnya: boolean; halaman: number; adaSorotan: boolean };

const tautanHalaman = (n: number) => (n <= 1 ? '/gallery' : `/gallery?halaman=${n}`);

/** Tiga keadaan terpisah: galat muat (bukan "kosong"), katalog kosong, dan halaman di luar rentang. */
export default function DaftarDokumen({ dokumen, galat, adaBerikutnya, halaman, adaSorotan }: Props) {
  let isi;
  if (galat) {
    isi = (
      <CatatanKeadaan jenis="galat" judul="Dokumen belum dapat dimuat" aksi={<Tombol href={tautanHalaman(halaman)} varian="sekunder">Muat ulang</Tombol>}>
        Terjadi gangguan sesaat saat mengambil daftar dokumen. Coba lagi beberapa saat lagi.
      </CatatanKeadaan>
    );
  } else if (dokumen.length === 0 && halaman > 1) {
    isi = (
      <StatusKosong ikon={FileSearch} judul="Tidak ada dokumen di halaman ini" aksi={<Tombol href="/gallery" varian="sekunder">Ke halaman pertama</Tombol>} />
    );
  } else if (dokumen.length === 0) {
    isi = adaSorotan ? null : <StatusKosong ikon={FileText} judul="Belum ada dokumen tersedia" isi="Dokumen baru akan tampil di sini setelah diterbitkan petugas." />;
  } else {
    isi = <KisiDokumen dokumen={dokumen} label="Daftar dokumen investasi" />;
  }
  if (isi === null) return null;
  return (
    <section className={styles.daftar} aria-labelledby="judul-semua-dokumen">
      <h2 id="judul-semua-dokumen" className={styles.daftarJudul}>{adaSorotan ? 'Dokumen lainnya' : 'Semua dokumen'}</h2>
      {isi}
      {!galat && (halaman > 1 || adaBerikutnya) && (
        <nav aria-label="Halaman daftar dokumen" className={styles.paginasi}>
          {halaman > 1 ? <Tombol href={tautanHalaman(halaman - 1)} varian="sekunder">Sebelumnya</Tombol> : <span />}
          <span className={styles.paginasiNomor}>Halaman {halaman}</span>
          {adaBerikutnya ? <Tombol href={tautanHalaman(halaman + 1)} varian="sekunder">Berikutnya</Tombol> : <span />}
        </nav>
      )}
    </section>
  );
}
