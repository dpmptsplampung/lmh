import Link from 'next/link';
import { MapPin } from 'lucide-react';
import Tombol from '@/components/ui/Tombol';
import type { Kartu } from '@/lib/umkm-katalog/types';
import FotoKatalog, { inisialNama } from './FotoKatalog';
import StatistikProfil from './StatistikProfil';
import type { KonteksFormulir } from './FormulirKatalog';
import styles from './publik.module.css';

// Satu kartu usaha. Nama usaha adalah tautan ke profil dan menutupi seluruh kartu; tombol hubungi
// berada di atas lapisan tautan sehingga tetap bisa ditekan sendiri.
export default function KartuKatalog({ item, onHubungi }: {
  item: Kartu; onHubungi: (value: KonteksFormulir) => void;
}) {
  return <li className={styles.kartu}>
    <FotoKatalog src={item.foto?.url ?? null} alt={`Foto ${item.nama}`} isi inisial={inisialNama(item.nama)}
      className={styles.kartuFoto} />
    <div className={styles.kartuIsi}>
      <p className={styles.wilayah}><MapPin size={14} aria-hidden="true" />{item.kabupaten_kota}</p>
      <h3 className={styles.kartuNama}>
        <Link href={`/umkm/katalog/${item.id}`} className={styles.tautanKartu}>{item.nama}</Link>
      </h3>
      <p className={styles.jenisBaris}>{[item.jenis, item.kategori, item.spesifik].filter(Boolean).join(' · ')}</p>
      <p className={styles.ringkas}>{item.deskripsi}</p>
      <div className={styles.kartuKaki}>
        <StatistikProfil suka={item.suka} dilihat={item.dilihat} baru={item.baru} />
        <Tombol varian="sekunder" ukuran="kecil" className={styles.kartuTombol}
          onClick={() => onHubungi({ profil_id: item.id, nama: item.nama })}
          aria-label={`Hubungi lewat petugas untuk ${item.nama}`}>Hubungi lewat petugas</Tombol>
      </div>
    </div>
  </li>;
}
