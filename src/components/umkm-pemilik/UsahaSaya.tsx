'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Lencana from '@/components/ui/Lencana';
import Tombol from '@/components/ui/Tombol';
import katalog from '@/components/umkm-katalog/katalog.module.css';
import FormUsaha from './FormUsaha';
import { PemilikError, pemilikRequest } from './api';
import { ringkasStatus } from './status';
import type { Usaha } from '@/lib/umkm-katalog/types-g5';
import styles from './pemilik.module.css';

type Keadaan = 'memuat' | 'siap' | 'belum_masuk' | 'belum_buka' | 'galat';

export default function UsahaSaya() {
  const [items, setItems] = useState<Usaha[]>([]);
  const [berikut, setBerikut] = useState<string | null>(null);
  const [keadaan, setKeadaan] = useState<Keadaan>('memuat');
  const [pesan, setPesan] = useState('');
  const [memuatLagi, setMemuatLagi] = useState(false);
  const [daftar, setDaftar] = useState(false);
  const [percobaan, setPercobaan] = useState(0);

  const muat = useCallback(async (cursor: string | null, signal?: AbortSignal) => {
    try {
      const data = await pemilikRequest<{ items: Usaha[]; next_cursor: string | null }>(
        `?${cursor ? `cursor=${encodeURIComponent(cursor)}` : ''}`, { signal });
      if (signal?.aborted) return;
      setItems((lama) => (cursor ? [...lama, ...data.items] : data.items));
      setBerikut(data.next_cursor);
      setKeadaan('siap');
    } catch (e) {
      if (signal?.aborted) return;
      if (e instanceof PemilikError && e.status === 401) setKeadaan('belum_masuk');
      else if (e instanceof PemilikError && e.status === 503) setKeadaan('belum_buka');
      else { setPesan(e instanceof PemilikError ? e.message : 'Daftar usaha belum berhasil dimuat.'); setKeadaan('galat'); }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- daftar usaha selalu dibaca ulang dari server
    setKeadaan('memuat');
    void muat(null, controller.signal);
    return () => controller.abort();
  }, [muat, percobaan]);

  return <div className={katalog.halaman}>
    <h1>Usaha saya</h1>
    {keadaan === 'memuat' && <p role="status">Memuat usaha Anda...</p>}
    {keadaan === 'belum_buka' && <div className={katalog.keadaan} role="status">
      <p>Halaman Usaha saya belum dibuka. Silakan kembali lagi nanti.</p>
      <Tombol href="/umkm/katalog" varian="sekunder">Lihat katalog UMKM</Tombol>
    </div>}
    {keadaan === 'galat' && <div className={katalog.keadaan} role="alert">
      <p>{pesan}</p>
      <Tombol varian="sekunder" onClick={() => setPercobaan((n) => n + 1)}>Coba lagi</Tombol>
    </div>}
    {keadaan === 'belum_masuk' && <div className={katalog.keadaan}>
      <p>Masuk dengan akun pribadi Anda untuk mendaftarkan atau mengelola usaha.</p>
      <Tombol href={`/login?next=${encodeURIComponent('/me/usaha')}`}>Masuk</Tombol>
    </div>}
    {keadaan === 'siap' && <>
      <p>Daftarkan usaha Anda atau kelola profil yang sudah menjadi milik akun ini. Petugas memeriksa setiap
        pengajuan dan perubahan sebelum tampil di katalog.</p>
      {!daftar && <div className={styles.aksi}>
        <Tombol onClick={() => setDaftar(true)}>Daftarkan usaha</Tombol>
        <Tombol href="/umkm/katalog" varian="sekunder">Cari profil di katalog</Tombol>
      </div>}
      {daftar && <FormUsaha mode="daftar" onBatal={() => setDaftar(false)}
        onSelesai={() => { setDaftar(false); setPercobaan((n) => n + 1); }} />}
      {items.length === 0 && !daftar && <p>Belum ada usaha. Daftarkan usaha Anda, atau buka profil di katalog lalu
        tekan Ini usaha saya.</p>}
      <ul className={katalog.daftarBaris}>
        {items.map((u) => {
          const s = ringkasStatus(u);
          return <li key={u.pemilik_id} className={styles.baris}>
            <h3>{u.profil_nama}</h3>
            <p><Lencana nada={s.nada}>{s.label}</Lencana></p>
            <p>{s.teks}</p>
            {(u.catatan_petugas ?? u.alasan_tolak) && <p className={styles.catatan}>
              Catatan petugas: {u.catatan_petugas ?? u.alasan_tolak}</p>}
            {u.pemilik_status === 'ditolak' && <p><Link href={`/umkm/katalog/${u.id}`}>Ajukan klaim lagi</Link></p>}
            <p><Link href={`/me/usaha/${u.id}`}>Buka {u.profil_nama}</Link></p>
          </li>;
        })}
      </ul>
      {berikut && <Tombol varian="sekunder" memuat={memuatLagi} onClick={() => {
        setMemuatLagi(true); void muat(berikut).finally(() => setMemuatLagi(false));
      }}>Muat lebih banyak</Tombol>}
    </>}
  </div>;
}
