import Link from 'next/link';
import Tombol from '@/components/ui/Tombol';
import type { Kartu } from '@/lib/umkm-katalog/types';
import FotoKatalog from './FotoKatalog';
import StatistikProfil from './StatistikProfil';
import type { KonteksFormulir } from './FormulirKatalog';
import styles from './katalog.module.css';

export default function KartuKatalog({ item, onHubungi }: {
  item: Kartu; onHubungi: (value: KonteksFormulir) => void;
}) {
  return <li className={styles.kartu}>
    <FotoKatalog src={item.foto?.url ?? null} alt={`Foto ${item.nama}`} />
    <div className={styles.isiKartu}>
      <p className={styles.label}>{item.kabupaten_kota}</p>
      <h3><Link href={`/umkm/katalog/${item.id}`}>{item.nama}</Link></h3>
      <p>{[item.jenis, item.kategori, item.spesifik].filter(Boolean).join(' · ')}</p>
      <p>{item.deskripsi}</p>
      <StatistikProfil suka={item.suka} dilihat={item.dilihat} baru={item.baru} />
      <Tombol varian="sekunder" onClick={() => onHubungi({ profil_id: item.id, nama: item.nama })}
        aria-label={`Hubungi lewat petugas untuk ${item.nama}`}>Hubungi lewat petugas</Tombol>
    </div>
  </li>;
}
