'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Tombol from '@/components/ui/Tombol';
import styles from '@/components/umkm-katalog/katalog.module.css';
import { formatTanggal } from '@/lib/utils';
import { KatalogError, ambil, kirim } from './api';
import type { Daftar, HasilAjukan, Kebutuhan, KartuRekomendasi } from './types';

export default function KebutuhanSaya({ onPermintaanBaru, muatUlang }: {
  onPermintaanBaru: () => void; muatUlang: number;
}) {
  const [items, setItems] = useState<Kebutuhan[]>([]);
  const [berikut, setBerikut] = useState<string | null>(null);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState('');
  const muat = useCallback(async (cursor: string | null, signal?: AbortSignal) => {
    setMemuat(true); setGalat('');
    try {
      const data = await ambil<Daftar<Kebutuhan>>(
        `/kebutuhan${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, signal);
      setItems((lama) => (cursor ? [...lama, ...data.items] : data.items));
      setBerikut(data.next_cursor);
    } catch (e) {
      if (signal?.aborted) return;
      setGalat(e instanceof KatalogError ? e.message : 'Kebutuhan belum berhasil dimuat.');
    } finally { if (!signal?.aborted) setMemuat(false); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- daftar selalu dibaca dari server
    void muat(null, controller.signal);
    return () => controller.abort();
  }, [muat, muatUlang]);

  return <section aria-labelledby="judul-kebutuhan" className={styles.hasil}>
    <h2 id="judul-kebutuhan">Kebutuhan saya</h2>
    {galat && <div role="alert" className={styles.galat}>{galat}{' '}
      <Tombol varian="sekunder" onClick={() => void muat(null)}>Coba lagi</Tombol></div>}
    {memuat && items.length === 0 && !galat && <p role="status">Memuat kebutuhan...</p>}
    {!memuat && !galat && items.length === 0 && <p>Belum ada Kebutuhan. Kebutuhan dibuat saat Anda menekan
      Hubungi UMKM pada sebuah profil.</p>}
    <ul className={styles.daftarBaris}>
      {items.map((item) => <BarisKebutuhan key={item.id} item={item} onPermintaanBaru={onPermintaanBaru}
        onTutup={() => setItems((lama) => lama.map((x) => x.id === item.id ? { ...x, status: 'ditutup' } : x))} />)}
    </ul>
    {berikut && <Tombol varian="sekunder" memuat={memuat} onClick={() => void muat(berikut)}>Muat lebih banyak</Tombol>}
  </section>;
}

function BarisKebutuhan({ item, onTutup, onPermintaanBaru }: {
  item: Kebutuhan; onTutup: () => void; onPermintaanBaru: () => void;
}) {
  const [rekomendasi, setRekomendasi] = useState<KartuRekomendasi[] | null>(null);
  const [terbuka, setTerbuka] = useState(false);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState('');
  const [ditambah, setDitambah] = useState<Record<string, boolean>>({});
  const operasi = useRef<Record<string, string>>({});
  const aktif = item.status === 'aktif';

  const bukaRekomendasi = async () => {
    if (terbuka) { setTerbuka(false); return; }
    setTerbuka(true); setGalat('');
    if (rekomendasi) return;
    setSibuk(true);
    try {
      const data = await ambil<{ items: KartuRekomendasi[] }>(`/kebutuhan/${item.id}/rekomendasi`);
      setRekomendasi(data.items);
    } catch (e) {
      setGalat(e instanceof KatalogError ? e.message : 'Rekomendasi belum berhasil dimuat.');
    } finally { setSibuk(false); }
  };
  const tambah = async (profilId: string) => {
    setGalat('');
    operasi.current[profilId] ??= crypto.randomUUID();
    try {
      await kirim<HasilAjukan>('/permintaan', {
        kebutuhan_id: item.id, profil_ids: [profilId], operasi_id: operasi.current[profilId],
      });
      setDitambah((lama) => ({ ...lama, [profilId]: true }));
      onPermintaanBaru();
    } catch (e) {
      setGalat(e instanceof KatalogError ? e.message : 'Permintaan belum pasti terkirim. Coba lagi.');
    }
  };
  const tutup = async () => {
    setSibuk(true); setGalat('');
    try { await kirim(`/kebutuhan/${item.id}/tutup`); onTutup(); onPermintaanBaru(); } catch (e) {
      setGalat(e instanceof KatalogError ? e.message : 'Kebutuhan belum berhasil ditutup.');
    } finally { setSibuk(false); }
  };

  return <li className={styles.baris}>
    <h3>{item.teks}</h3>
    <p className={styles.label}>
      {[item.kategori, item.kabupaten_kota, aktif ? 'Aktif' : 'Ditutup', formatTanggal(item.dibuat_pada)]
        .filter(Boolean).join(' · ')}
    </p>
    {galat && <div role="alert" className={styles.galat}>{galat}</div>}
    {aktif && <div className={styles.aksi}>
      <Tombol varian="sekunder" aria-expanded={terbuka} onClick={() => void bukaRekomendasi()}>
        {terbuka ? 'Sembunyikan rekomendasi' : 'Lihat rekomendasi UMKM'}</Tombol>
      <Tombol varian="hantu" memuat={sibuk} onClick={() => void tutup()}>Tutup Kebutuhan</Tombol>
    </div>}
    {aktif && terbuka && <div aria-label={`Rekomendasi untuk ${item.teks}`}>
      {rekomendasi === null && sibuk && <p role="status">Memuat rekomendasi...</p>}
      {rekomendasi?.length === 0 && <p>Belum ada UMKM yang cocok saat ini.</p>}
      <ul className={styles.daftarBaris}>
        {rekomendasi?.map((kartu) => <li key={kartu.id} className={styles.baris}>
          <p><Link href={`/umkm/katalog/${kartu.id}`}>{kartu.nama}</Link></p>
          <p className={styles.label}>{[kartu.kategori, kartu.kabupaten_kota].join(' · ')}</p>
          {ditambah[kartu.id] ? <p role="status">Ditambahkan ke permintaan Anda.</p> : <div className={styles.aksi}>
            <Tombol onClick={() => void tambah(kartu.id)} aria-label={`Hubungi ${kartu.nama}`}>
              Tambah ke permintaan</Tombol></div>}
        </li>)}
      </ul>
    </div>}
  </li>;
}
