'use client';

import { useCallback, useEffect, useState } from 'react';
import katalog from '@/components/umkm-katalog/katalog.module.css';
import Tombol from '@/components/ui/Tombol';
import { PemilikError, pemilikRequest } from './api';
import { tanggalWIB } from './status';
import type { PenerimaPemilik } from '@/lib/umkm-katalog/types-g5';

// Hanya nama perusahaan dan tanggal pembukaan. Tidak ada data pribadi pemohon.
export default function PerusahaanPenerima({ id, muatUlang }: { id: string; muatUlang: number }) {
  const [items, setItems] = useState<PenerimaPemilik['items']>([]);
  const [berikut, setBerikut] = useState<string | null>(null);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState('');
  const muat = useCallback(async (cursor: string | null, signal?: AbortSignal) => {
    setMemuat(true); setGalat('');
    try {
      const d = await pemilikRequest<PenerimaPemilik>(
        `/${id}/penerima${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { signal });
      if (signal?.aborted) return;
      setItems((lama) => (cursor ? [...lama, ...d.items] : d.items));
      setBerikut(d.next_cursor);
    } catch (e) {
      if (signal?.aborted) return;
      setGalat(e instanceof PemilikError ? e.message : 'Daftar belum berhasil dimuat.');
    } finally { if (!signal?.aborted) setMemuat(false); }
  }, [id]);
  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- daftar dibaca ulang dari server
    void muat(null, controller.signal);
    return () => controller.abort();
  }, [muat, muatUlang]);

  return <section aria-labelledby="judul-penerima" className={katalog.hasil}>
    <h2 id="judul-penerima">Perusahaan yang menerima nomor Anda</h2>
    {galat && <div role="alert" className={katalog.galat}>{galat}{' '}
      <Tombol varian="sekunder" onClick={() => void muat(null)}>Coba lagi</Tombol></div>}
    {memuat && items.length === 0 && !galat && <p role="status">Memuat daftar...</p>}
    {!memuat && !galat && items.length === 0 && <p>Belum ada perusahaan yang menerima nomor Anda.</p>}
    {items.length > 0 && <ul>
      {items.map((p, i) => <li key={`${p.dibuka_pada}:${i}`}>{p.nama}, dibuka {tanggalWIB(p.dibuka_pada)}</li>)}
    </ul>}
    {berikut && <Tombol varian="sekunder" memuat={memuat} onClick={() => void muat(berikut)}>Muat lebih banyak</Tombol>}
  </section>;
}
