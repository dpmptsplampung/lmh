import Image from 'next/image';
import Link from 'next/link';
import { Landmark, MapPin } from 'lucide-react';
import type { KartuPublik } from '@/lib/data/publik-server';
import { formatPersen } from '@/lib/investasi/format';
import Lencana from '@/components/ui/Lencana';
import { labelSektor, labelTahap, teksNilai } from './label';
import styles from './investasi.module.css';

/** Kartu proyek PTSP: seluruh kartu menaut ke halaman detail lewat satu tautan pada judul. Heading h3 (di bawah h2 seksi). */
export default function KartuIpro({ kartu }: { kartu: KartuPublik }) {
  const nilai = teksNilai(kartu);
  const tahap = labelTahap(kartu.tahap_kajian);
  return (
    <article className={styles.kartu}>
      <div className={styles.kartuGambar}>
        {kartu.gambar ? (
          <Image
            src={kartu.gambar.url_mini}
            alt={kartu.gambar.alt}
            width={kartu.gambar.lebar}
            height={kartu.gambar.tinggi}
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            unoptimized
            className={styles.kartuFoto}
          />
        ) : (
          <span className={styles.gambarKosong} aria-hidden="true"><Landmark size={40} strokeWidth={1.5} /></span>
        )}
      </div>
      <div className={styles.kartuIsi}>
        <div className={styles.lencanaBaris}>
          <Lencana nada="primer">{labelSektor(kartu.sektor)}</Lencana>
          {tahap && <Lencana nada="netral">{tahap}</Lencana>}
        </div>
        <h3 className={styles.kartuJudul}>
          <Link href={`/investasi/ipro/${kartu.slug}`} className={styles.kartuTautan}>{kartu.judul}</Link>
        </h3>
        <p className={styles.kartuRingkas}>{kartu.ringkasan}</p>
        <p className={styles.kartuLokasi}><MapPin size={14} aria-hidden="true" /> {kartu.kab_kota}</p>
        {(nilai || kartu.irr_persen !== null) && (
          <dl className={styles.kartuAngka}>
            {nilai && <div><dt>Nilai</dt><dd>{nilai}</dd></div>}
            {kartu.irr_persen !== null && <div><dt>IRR</dt><dd>{formatPersen(kartu.irr_persen)}</dd></div>}
          </dl>
        )}
      </div>
    </article>
  );
}
