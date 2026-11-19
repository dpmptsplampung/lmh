import Image from 'next/image';
import { ExternalLink, MapPin } from 'lucide-react';
import type { KartuPublik } from '@/lib/data/publik-server';
import Lencana from '@/components/ui/Lencana';
import { labelSektor, teksNilai } from './label';
import styles from './investasi.module.css';

/**
 * Kartu proyek dari portal FOILA: hanya cuplikan dan satu tautan keluar (tanpa halaman detail di LMH).
 * Seluruh kartu adalah tautan; teks tersembunyi memberi tahu pembaca layar bahwa tautan membuka tab baru.
 */
export default function KartuFoila({ kartu }: { kartu: KartuPublik }) {
  if (!kartu.sumber_url) return null;
  const nilai = teksNilai(kartu);
  return (
    <a href={kartu.sumber_url} target="_blank" rel="noopener noreferrer external" className={styles.kartuFoila}>
      {kartu.gambar && (
        <Image
          src={kartu.gambar.url_mini}
          alt={kartu.gambar.alt}
          width={kartu.gambar.lebar}
          height={kartu.gambar.tinggi}
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          unoptimized
          className={styles.foilaFoto}
        />
      )}
      <span className={styles.foilaIsi}>
        <span className={styles.lencanaBaris}>
          <Lencana nada="info">Sumber: FOILA</Lencana>
          <Lencana nada="netral">{labelSektor(kartu.sektor)}</Lencana>
        </span>
        <h3 className={styles.foilaJudul}>{kartu.judul}</h3>
        <span className={styles.kartuRingkas}>{kartu.ringkasan}</span>
        <span className={styles.kartuLokasi}><MapPin size={14} aria-hidden="true" /> {kartu.kab_kota}</span>
        {nilai && <span className={styles.foilaNilai}>{nilai}</span>}
        <span className={styles.foilaAjak}>
          Lihat di FOILA <ExternalLink size={14} aria-hidden="true" />
          <span className="sr-only"> (membuka situs FOILA di tab baru)</span>
        </span>
      </span>
    </a>
  );
}
