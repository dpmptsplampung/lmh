'use client';

import type { CSSProperties } from 'react';
import { useSaringHash } from '../_hook/useSaringHash';
import { ringkasPeta, SARINGAN_KOSONG } from '../_logika/saring';
import styles from '../investasi.module.css';

type Sebaran = { sektor: string; kab_kota: string; jumlah: number }[];

/**
 * Jelajah Proyek: kisi sebaran proyek IPRO per sektor dan kabupaten/kota (tanpa ubin peta).
 * Memilih satu kotak mengatur saringan daftar proyek lalu menggulir ke daftar. Hanya sektor berisi yang tampil sebagai
 * kotak berbatang; sektor kosong diringkas satu baris.
 */
export default function SeksiJelajahProyek({ sebaran }: { sebaran: Sebaran }) {
  const { saringan, ubah } = useSaringHash();
  const peta = ringkasPeta(sebaran);
  const berisi = peta.sektor.filter(s => s.jumlah > 0);
  const kosong = peta.sektor.length - berisi.length;
  const terbanyak = Math.max(1, ...berisi.map(s => s.jumlah));
  // Batang membandingkan sektor; bila semua nilainya sama ia tidak memberi informasi dan disembunyikan.
  const batang = new Set(berisi.map(s => s.jumlah)).size > 1;
  const pilih = (sebagian: Partial<typeof SARINGAN_KOSONG>) => {
    ubah({ ...SARINGAN_KOSONG, ...sebagian });
    document.getElementById('proyek-ptsp')?.scrollIntoView?.({ block: 'start' });
  };

  return (
    <section id="jelajah-proyek" className={`${styles.pita} ${styles.pitaLembut}`} aria-labelledby="judul-jelajah-proyek">
      <div className={styles.pitaIsi}>
        <div className={styles.seksiKepala}>
          <h2 id="judul-jelajah-proyek" className={styles.seksiJudul}>Jelajah Proyek</h2>
          <p className={styles.seksiIntro}>Sebaran proyek IPRO PTSP menurut sektor dan kabupaten/kota. Pilih satu kotak untuk menyaring daftar proyek di atas.</p>
        </div>
        <div className={styles.jelajahKisi} data-kolom={peta.kab.length > 0 ? 2 : 1}>
          <div>
            <h3 className={styles.subJudul}>Menurut sektor</h3>
            <ul className={styles.sektorDaftar} data-jumlah={berisi.length}>
              {berisi.map(s => (
                <li key={s.nilai}>
                  <button type="button" className={styles.sektorKotak} aria-pressed={saringan.sektor === s.nilai} onClick={() => pilih({ sektor: s.nilai })}>
                    <span className={styles.sektorBaris}>
                      <span className={styles.sektorNama}>{s.label}</span>
                      <span className={styles.sektorJumlah}>{s.jumlah} proyek</span>
                    </span>
                    {batang && <span className={styles.sektorBatang} style={{ '--bagian': s.jumlah / terbanyak } as CSSProperties} aria-hidden="true" />}
                    {s.kab.length > 0 && <span className={styles.sektorWilayah}>{s.kab.join(', ')}</span>}
                  </button>
                </li>
              ))}
            </ul>
            {kosong > 0 && <p className={styles.sektorKosong}>{kosong} sektor lain belum ada proyek.</p>}
          </div>
          {peta.kab.length > 0 && (
            <div>
              <h3 className={styles.subJudul}>Menurut kabupaten/kota</h3>
              <ul className={styles.wilayahDaftar}>
                {peta.kab.map(k => (
                  <li key={k.nilai}>
                    <button type="button" className={styles.wilayahChip} aria-pressed={saringan.kab === k.nilai} onClick={() => pilih({ kab: k.nilai })}>
                      {k.nilai} <span className={styles.wilayahJumlah}>{k.jumlah}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
