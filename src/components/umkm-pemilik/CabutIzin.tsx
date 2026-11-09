'use client';

import { useRef, useState } from 'react';
import Dialog from '@/components/ui/Dialog';
import Tombol from '@/components/ui/Tombol';
import { PemilikError, TEKS_PENCABUTAN, hasilBelumPasti, kirimPemilik } from './api';
import type { MutasiPemilik } from '@/lib/umkm-katalog/types-g5';
import styles from './pemilik.module.css';

export default function CabutIzin({ id, versi, onSelesai }: { id: string; versi: number; onSelesai: () => void }) {
  const [terbuka, setTerbuka] = useState(false);
  const [busy, setBusy] = useState(false);
  const [galat, setGalat] = useState('');
  const operasi = useRef<string | null>(null);
  const tutup = () => { if (!busy) { setTerbuka(false); setGalat(''); } };
  const cabut = async () => {
    setBusy(true); setGalat('');
    operasi.current ??= crypto.randomUUID();
    try {
      await kirimPemilik<MutasiPemilik>(`/${id}/cabut-izin`, { expected_version: versi, operasi_id: operasi.current });
      operasi.current = null; setTerbuka(false); onSelesai();
    } catch (e) {
      if (!hasilBelumPasti(e)) operasi.current = null;
      setGalat(e instanceof PemilikError ? e.message : 'Izin belum berhasil dicabut.');
    } finally { setBusy(false); }
  };
  return <>
    <Tombol varian="bahaya" onClick={() => setTerbuka(true)}>Cabut izin nomor</Tombol>
    <Dialog terbuka={terbuka} onTutup={tutup} dikunci={busy} judul="Cabut izin nomor?" deskripsi={TEKS_PENCABUTAN}
      kaki={<div className={styles.aksi}>
        <Tombol varian="hantu" onClick={tutup} disabled={busy}>Batal</Tombol>
        <Tombol varian="bahaya" memuat={busy} onClick={() => void cabut()}>Ya, cabut izin</Tombol>
      </div>}>
      {galat && <p role="alert" className={styles.galat}>{galat}</p>}
    </Dialog>
  </>;
}
