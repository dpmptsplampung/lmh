import { ExternalLink } from 'lucide-react';
import type { KartuPublik } from '@/lib/data/publik-server';
import KartuFoila from '@/components/investasi/KartuFoila';
import { HOST_FOILA } from '@/lib/investasi/konstanta';
import { jumlahKisi } from '../_logika/kisi';
import styles from '../investasi.module.css';

/** Kartu proyek dari portal FOILA: cuplikan dan tautan keluar, tanpa halaman detail di LMH. */
export default function SeksiFoila({ daftar }: { daftar: KartuPublik[] }) {
  return (
    <section className={styles.pita} aria-labelledby="judul-foila">
      <div className={styles.pitaIsi}>
        <div className={styles.seksiKepalaBaris}>
          <div className={styles.seksiKepala}>
            <h2 id="judul-foila" className={styles.seksiJudul}>Dari portal FOILA</h2>
            <p className={styles.seksiIntro}>
              Proyek daerah lain dari Forum Investasi Lampung (FOILA).
            </p>
          </div>
          <a className={styles.tautanLuar} href={`https://${HOST_FOILA}/`} target="_blank" rel="noopener noreferrer external">
            Kunjungi portal FOILA <ExternalLink size={14} aria-hidden="true" />
            <span className="sr-only"> (membuka situs FOILA di tab baru)</span>
          </a>
        </div>
        {daftar.length > 0 && (
          <ul className={styles.kisi} data-jumlah={jumlahKisi(daftar.length)}>
            {daftar.map(k => <li key={k.id}><KartuFoila kartu={k} /></li>)}
          </ul>
        )}
      </div>
    </section>
  );
}
