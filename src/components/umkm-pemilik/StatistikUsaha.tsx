'use client';

import { useEffect, useState } from 'react';
import katalog from '@/components/umkm-katalog/katalog.module.css';
import Tombol from '@/components/ui/Tombol';
import { PemilikError, pemilikRequest } from './api';
import type { StatistikPemilik } from '@/lib/umkm-katalog/types-g5';
import styles from './pemilik.module.css';

type Pilihan = 'dilihat' | 'suka' | 'permintaan' | 'nomor_dibuka';
const JUDUL: Record<Pilihan, string> = {
  dilihat: 'Dilihat', suka: 'Suka', permintaan: 'Permintaan nomor', nomor_dibuka: 'Nomor dibuka',
};

// Angka dan tren 30 hari tanpa pustaka grafik: batang CSS, dengan daftar teks untuk pembaca layar.
export default function StatistikUsaha({ id }: { id: string }) {
  const [data, setData] = useState<StatistikPemilik | null>(null);
  const [galat, setGalat] = useState('');
  const [percobaan, setPercobaan] = useState(0);
  const [pilih, setPilih] = useState<Pilihan>('suka');
  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- statistik dibaca ulang dari server
    setGalat(''); setData(null);
    void pemilikRequest<StatistikPemilik>(`/${id}/statistik`, { signal: controller.signal })
      .then((d) => { if (!controller.signal.aborted) setData(d); })
      .catch((e) => {
        if (!controller.signal.aborted) setGalat(e instanceof PemilikError ? e.message : 'Statistik belum berhasil dimuat.');
      });
    return () => controller.abort();
  }, [id, percobaan]);

  return <section aria-labelledby="judul-statistik" className={katalog.hasil}>
    <h2 id="judul-statistik">Statistik profil</h2>
    {galat && <div role="alert" className={katalog.galat}>{galat}{' '}
      <Tombol varian="sekunder" onClick={() => setPercobaan((n) => n + 1)}>Coba lagi</Tombol></div>}
    {!data && !galat && <p role="status">Memuat statistik...</p>}
    {data && <>
      <dl className={styles.angka}>
        {(Object.keys(JUDUL) as Pilihan[]).map((k) => <div key={k}>
          <dt>{JUDUL[k]}</dt>
          <dd>{data[k] === null ? <span title="Pencatatan tampilan sedang tidak aktif">Tidak dicatat</span> : data[k]}</dd>
        </div>)}
      </dl>
      <div role="group" aria-label="Pilih data tren 30 hari" className={styles.aksi}>
        {(Object.keys(JUDUL) as Pilihan[]).filter((k) => k !== 'dilihat' || data.telemetri_opsional_aktif).map((k) =>
          <Tombol key={k} varian={pilih === k ? 'utama' : 'sekunder'} ukuran="kecil" aria-pressed={pilih === k}
            onClick={() => setPilih(k)}>{JUDUL[k]}</Tombol>)}
      </div>
      <Tren tren={data.tren} pilih={pilih} />
    </>}
  </section>;
}

function Tren({ tren, pilih }: { tren: StatistikPemilik['tren']; pilih: Pilihan }) {
  const nilai = tren.map((t) => t[pilih] ?? 0);
  const maks = Math.max(1, ...nilai);
  const total = nilai.reduce((a, b) => a + b, 0);
  return <div>
    <p>{JUDUL[pilih]} dalam 30 hari terakhir: {total}</p>
    <ul className={styles.tren} aria-hidden="true">
      {tren.map((t, i) => <li key={t.hari} style={{ height: `${Math.round((nilai[i] / maks) * 100)}%` }} />)}
    </ul>
    <details>
      <summary>Lihat angka per hari</summary>
      <ul>{tren.map((t, i) => <li key={t.hari}>{t.hari}: {nilai[i]}</li>)}</ul>
    </details>
  </div>;
}
