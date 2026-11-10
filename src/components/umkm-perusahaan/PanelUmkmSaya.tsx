'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Tombol from '@/components/ui/Tombol';
import styles from '@/components/umkm-katalog/katalog.module.css';
import { KatalogError, ambil } from './api';
import FormPerusahaan from './FormPerusahaan';
import KebutuhanSaya from './KebutuhanSaya';
import KodeTautan from './KodeTautan';
import PermintaanSayaDaftar from './PermintaanSayaDaftar';
import type { Perusahaan, SesiPerusahaan } from './types';

type Keadaan = { fase: 'memuat' } | { fase: 'belum_buka' } | { fase: 'galat'; pesan: string }
  | { fase: 'belum_masuk' } | { fase: 'siap'; perusahaan: Perusahaan | null };

export default function PanelUmkmSaya() {
  const [keadaan, setKeadaan] = useState<Keadaan>({ fase: 'memuat' });
  const [percobaan, setPercobaan] = useState(0);
  const [muatUlang, setMuatUlang] = useState(0);
  const [muatUlangKebutuhan, setMuatUlangKebutuhan] = useState(0);
  const segarkan = useCallback(() => setMuatUlang((nilai) => nilai + 1), []);
  // Sesudah tautkan kode, Kebutuhan bantuan pindah ke akun ini: kedua daftar dibaca ulang.
  const segarkanSemua = useCallback(() => {
    setMuatUlang((nilai) => nilai + 1); setMuatUlangKebutuhan((nilai) => nilai + 1);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- status akun dibaca ulang dari server
    setKeadaan({ fase: 'memuat' });
    void ambil<SesiPerusahaan>('/perusahaan', controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      setKeadaan(data.masuk ? { fase: 'siap', perusahaan: data.perusahaan } : { fase: 'belum_masuk' });
    }).catch((e) => {
      if (controller.signal.aborted) return;
      if (e instanceof KatalogError && e.status === 503) setKeadaan({ fase: 'belum_buka' });
      else {
        setKeadaan({ fase: 'galat', pesan: e instanceof KatalogError ? e.message : 'Halaman belum berhasil dimuat.' });
      }
    });
    return () => controller.abort();
  }, [percobaan]);

  return <div className={styles.halaman}>
    <h1>Cari pemasok</h1>
    {keadaan.fase === 'memuat' && <p role="status">Memuat...</p>}
    {keadaan.fase === 'belum_buka' && <div className={styles.keadaan} role="status">
      <p>Fitur Hubungi UMKM belum dibuka. Silakan kembali lagi nanti.</p>
      <Tombol href="/umkm/katalog" varian="sekunder">Lihat katalog UMKM</Tombol>
    </div>}
    {keadaan.fase === 'galat' && <div className={styles.keadaan} role="alert">
      <p>{keadaan.pesan}</p>
      <Tombol varian="sekunder" onClick={() => setPercobaan((n) => n + 1)}>Coba lagi</Tombol>
    </div>}
    {keadaan.fase === 'belum_masuk' && <div className={styles.keadaan}>
      <p>Masuk dengan akun pribadi Anda untuk melihat permintaan nomor UMKM.</p>
      <Tombol href={`/login?next=${encodeURIComponent('/me/umkm')}`}>Masuk</Tombol>
    </div>}
    {keadaan.fase === 'siap' && <>
      {keadaan.perusahaan ? <p className={styles.label}>
        Perusahaan: {keadaan.perusahaan.nama} ({keadaan.perusahaan.jabatan})
      </p> : <section aria-labelledby="judul-perusahaan" className={styles.hasil}>
        <h2 id="judul-perusahaan">Data perusahaan</h2>
        <FormPerusahaan onSimpan={(perusahaan) => setKeadaan({ fase: 'siap', perusahaan })} />
      </section>}
      <KebutuhanSaya onPermintaanBaru={segarkan} muatUlang={muatUlangKebutuhan} />
      <PermintaanSayaDaftar muatUlang={muatUlang} />
      {keadaan.perusahaan && <KodeTautan onTertaut={segarkanSemua} />}
      <p><Link href="/umkm/katalog">Kembali ke katalog UMKM</Link></p>
    </>}
  </div>;
}
