import Image from 'next/image';
import Link from 'next/link';
import { Landmark, MapPin } from 'lucide-react';
import type { DetailIproPublik } from '@/lib/data/publik-server';
import Lencana from '@/components/ui/Lencana';
import { labelSektor, labelTahap, tanggalPanjangWIB } from '@/components/investasi/label';
import styles from '../detail.module.css';

type Props = { ipro: DetailIproPublik; aksi: React.ReactNode };

/** Remah roti, foto utama, judul, label, dan aksi utama (`aksi` = tombol Hubungi petugas / Lihat dokumen). */
export default function HeroIpro({ ipro, aksi }: Props) {
  const utama = ipro.gambar.find(g => g.utama) ?? ipro.gambar[0] ?? null;
  const tahap = labelTahap(ipro.tahap_kajian);
  const diperbarui = tanggalPanjangWIB(ipro.diubah_pada);
  return (
    <header className={styles.hero}>
      <nav aria-label="Remah roti" className={styles.remah}>
        <ol>
          <li><Link href="/investasi">Investasi</Link></li>
          <li aria-current="page">{ipro.judul}</li>
        </ol>
      </nav>
      <div className={styles.heroKisi}>
        <div className={styles.heroFoto}>
          {utama ? (
            <Image src={utama.url} alt={utama.alt} width={utama.lebar} height={utama.tinggi} sizes="(max-width: 1024px) 100vw, 640px" unoptimized priority />
          ) : (
            <span className={styles.heroKosong} aria-hidden="true"><Landmark size={56} strokeWidth={1.5} /></span>
          )}
        </div>
        <div className={styles.heroIsi}>
          <div className={styles.lencanaBaris}>
            <Lencana nada="primer">{labelSektor(ipro.sektor)}</Lencana>
            {tahap && <Lencana nada="netral">{tahap}</Lencana>}
          </div>
          <h1 className={styles.heroJudul}>{ipro.judul}</h1>
          <p className={styles.heroLokasi}><MapPin size={16} aria-hidden="true" /> {ipro.kab_kota}{ipro.lokasi_teks ? ` · ${ipro.lokasi_teks}` : ''}</p>
          <p className={styles.heroRingkas}>{ipro.ringkasan}</p>
          {aksi}
          {diperbarui && <p className={styles.diperbarui}>Diperbarui {diperbarui}</p>}
        </div>
      </div>
    </header>
  );
}
