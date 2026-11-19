'use client';

import { useSaringHash } from '../_hook/useSaringHash';
import { ringkasPeta, SARINGAN_KOSONG } from '../_logika/saring';
import styles from '../investasi.module.css';

type Sebaran = { sektor: string; kab_kota: string; jumlah: number }[];

/**
 * Peta Potensi v1 tanpa ubin peta: kisi sektor dan kabupaten/kota dengan jumlah proyek.
 * Memilih satu kotak mengatur saringan daftar proyek lalu menggulir ke daftar.
 */
export default function SeksiPetaPotensi({ sebaran }: { sebaran: Sebaran }) {
  const { saringan, ubah } = useSaringHash();
  const peta = ringkasPeta(sebaran);
  const pilih = (sebagian: Partial<typeof SARINGAN_KOSONG>) => {
    ubah({ ...SARINGAN_KOSONG, ...sebagian });
    document.getElementById('proyek-ptsp')?.scrollIntoView?.({ block: 'start' });
  };

  return (
    <section id="peta-potensi" className={styles.seksi} aria-labelledby="judul-peta-potensi">
      <div className={styles.seksiKepala}>
        <h2 id="judul-peta-potensi" className={styles.seksiJudul}>Peta Potensi Investasi</h2>
        <p className={styles.seksiIntro}>Sebaran proyek IPRO PTSP menurut sektor dan kabupaten/kota. Pilih satu kotak untuk menyaring daftar proyek PTSP.</p>
      </div>
      <h3 className={styles.subJudul}>Menurut sektor</h3>
      <ul className={styles.petaKisi}>
        {peta.sektor.map(s => (
          <li key={s.nilai}>
            <button
              type="button"
              className={styles.petaKotak}
              disabled={s.jumlah === 0}
              aria-pressed={saringan.sektor === s.nilai}
              onClick={() => pilih({ sektor: s.nilai })}
            >
              <span className={styles.petaNama}>{s.label}</span>
              <span className={styles.petaJumlah}>{s.jumlah === 0 ? 'Belum ada proyek' : `${s.jumlah} proyek`}</span>
              {s.kab.length > 0 && <span className={styles.petaWilayah}>{s.kab.join(', ')}</span>}
            </button>
          </li>
        ))}
      </ul>
      {peta.kab.length > 0 && (
        <>
          <h3 className={styles.subJudul}>Menurut kabupaten/kota</h3>
          <ul className={styles.petaWilayahDaftar}>
            {peta.kab.map(k => (
              <li key={k.nilai}>
                <button type="button" className={styles.petaChip} aria-pressed={saringan.kab === k.nilai} onClick={() => pilih({ kab: k.nilai })}>
                  {k.nilai} <span className={styles.petaChipJumlah}>{k.jumlah}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
