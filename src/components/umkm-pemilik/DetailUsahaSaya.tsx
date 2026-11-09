'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Lencana from '@/components/ui/Lencana';
import Tombol from '@/components/ui/Tombol';
import FotoUmkm from '@/components/umkm/FotoUmkm';
import katalog from '@/components/umkm-katalog/katalog.module.css';
import CabutIzin from './CabutIzin';
import FormUsaha from './FormUsaha';
import PerusahaanPenerima from './PerusahaanPenerima';
import StatistikUsaha from './StatistikUsaha';
import { PemilikError, TEKS_NIB, pemilikRequest } from './api';
import { ringkasStatus } from './status';
import type { DetailUsaha } from '@/lib/umkm-katalog/types-g5';
import styles from './pemilik.module.css';

type Keadaan = { fase: 'memuat' } | { fase: 'galat'; pesan: string; status: number } | { fase: 'siap'; detail: DetailUsaha };

export default function DetailUsahaSaya({ id }: { id: string }) {
  const [keadaan, setKeadaan] = useState<Keadaan>({ fase: 'memuat' });
  const [percobaan, setPercobaan] = useState(0);
  const [ubah, setUbah] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- detail selalu dibaca ulang dari server
    setKeadaan({ fase: 'memuat' });
    void pemilikRequest<DetailUsaha>(`/${id}`, { signal: controller.signal })
      .then((detail) => { if (!controller.signal.aborted) setKeadaan({ fase: 'siap', detail }); })
      .catch((e) => {
        if (controller.signal.aborted) return;
        const galat = e instanceof PemilikError ? e : new PemilikError('GAGAL_INTERNAL', 500);
        setKeadaan({ fase: 'galat', pesan: galat.message, status: galat.status });
      });
    return () => controller.abort();
  }, [id, percobaan]);
  const segarkan = () => { setUbah(false); setPercobaan((n) => n + 1); };

  return <div className={katalog.halaman}>
    <Link href="/me/usaha" className={katalog.kembali}>Kembali ke Usaha saya</Link>
    {keadaan.fase === 'memuat' && <><h1>Usaha saya</h1><p role="status">Memuat usaha...</p></>}
    {keadaan.fase === 'galat' && <div className={katalog.keadaan} role="alert">
      <h1>Usaha belum dapat ditampilkan</h1>
      <p>{keadaan.pesan}</p>
      {keadaan.status === 401
        ? <Tombol href={`/login?next=${encodeURIComponent(`/me/usaha/${id}`)}`}>Masuk</Tombol>
        : <Tombol varian="sekunder" onClick={() => setPercobaan((n) => n + 1)}>Coba lagi</Tombol>}
    </div>}
    {keadaan.fase === 'siap' && <Isi detail={keadaan.detail} ubah={ubah} setUbah={setUbah} segarkan={segarkan} />}
  </div>;
}

function Isi({ detail, ubah, setUbah, segarkan }: {
  detail: DetailUsaha; ubah: boolean; setUbah: (v: boolean) => void; segarkan: () => void;
}) {
  const s = ringkasStatus(detail);
  const disetujui = detail.pemilik_status === 'disetujui';
  const catatan = detail.catatan_petugas ?? detail.alasan_tolak;
  const rev = detail.revisi;
  return <>
    <header>
      <h1>{detail.profil_nama}</h1>
      <p><Lencana nada={s.nada}>{s.label}</Lencana></p>
      <p>{s.teks}</p>
      {catatan && <p className={styles.catatan}>Catatan petugas: {catatan}</p>}
    </header>
    {!disetujui && !rev && <p className={styles.info}>
      Hak mengubah, statistik, dan nomor berlaku sesudah petugas memastikan Anda penanggung jawab usaha ini.</p>}
    {rev && !ubah && <section aria-labelledby="judul-profil" className={katalog.hasil}>
      <h2 id="judul-profil">{detail.perubahan ? 'Perubahan yang diajukan' : 'Data profil'}</h2>
      <p>{[rev.jenis, rev.kategori, rev.spesifik].filter(Boolean).join(' · ')}, {rev.kabupaten_kota}</p>
      <p>{rev.deskripsi}</p>
      {detail.nomor && <p>Nomor WhatsApp Anda: <span className={styles.nomor}>{detail.nomor}</span>.
        Nomor ini hanya tampil di halaman ini.</p>}
      {detail.foto.length > 0 && <div className={styles.foto}>
        {detail.foto.map((f, i) => <figure key={f.id}>
          <FotoUmkm alt={`Foto ${i + 1} ${detail.profil_nama}`} width={160} height={120} style={{ width: '100%' }}
            src={f.asal === 'unggahan' ? `/api/umkm-pemilik/${detail.id}/foto/${f.id}` : (f.url ?? '')} />
        </figure>)}
      </div>}
      <div className={styles.aksi}><Tombol onClick={() => setUbah(true)}>Ubah profil</Tombol></div>
    </section>}
    {rev && ubah && <FormUsaha mode="draf" detail={detail} onBatal={() => setUbah(false)} onSelesai={segarkan} />}
    {detail.memiliki_nib !== true && <p className={styles.info}>{TEKS_NIB}</p>}
    {disetujui && <>
      <StatistikUsaha id={detail.id} />
      <PerusahaanPenerima id={detail.id} muatUlang={detail.versi} />
      <section aria-labelledby="judul-izin" className={katalog.hasil}>
        <h2 id="judul-izin">Izin nomor</h2>
        {detail.izin_status === 'diberikan' && detail.nomor
          ? <><p>Nomor Anda dapat diberikan petugas kepada perusahaan yang sudah diperiksa.</p>
            <div className={styles.aksi}><CabutIzin id={detail.id} versi={detail.versi} onSelesai={segarkan} /></div></>
          : <p>{detail.izin_status === 'dicabut' ? 'Izin sudah dicabut. Nomor Anda tidak diberikan ke perusahaan baru.'
            : 'Belum ada izin nomor yang aktif.'}</p>}
      </section>
    </>}
  </>;
}
