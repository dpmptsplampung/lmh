'use client';

import { useEffect, useRef, useState } from 'react';
import Tombol from '@/components/ui/Tombol';
import Field from '@/components/ui/Field';
import type { MutasiKlaim, PemilikTerdaftar } from '@/lib/umkm-katalog/types-g5';
import { hasilBelumPasti, kirimTugas, TugasError } from './api';
import styles from './umkm-tugas.module.css';

const TEKS_BANTU = 'Akun ini tidak lagi bisa mengubah profil, melihat nomor, atau melihat statistik. '
  + 'Perubahan yang sudah dikirimnya tetap perlu Anda tolak.';

function BarisPemilik({ pemilik, onSelesai }: { pemilik: PemilikTerdaftar; onSelesai: () => void }) {
  const [buka, setBuka] = useState(false);
  const [alasan, setAlasan] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<TugasError | null>(null);
  const operasi = useRef<{ tanda: string; id: string } | null>(null);
  const alasanRef = useRef<HTMLTextAreaElement>(null);
  const terpasang = useRef(true);
  useEffect(() => { terpasang.current = true; return () => { terpasang.current = false; }; }, []);
  useEffect(() => { if (buka) alasanRef.current?.focus(); }, [buka]);

  const cabut = async () => {
    const teks = alasan.trim();
    if (sibuk || !teks) return;
    setSibuk(true); setGalat(null);
    const tanda = JSON.stringify([pemilik.id, pemilik.versi, teks]);
    if (operasi.current?.tanda !== tanda) operasi.current = { tanda, id: crypto.randomUUID() };
    try {
      await kirimTugas<MutasiKlaim>(`/klaim/${pemilik.id}/cabut`, {
        expected_version: pemilik.versi, operasi_id: operasi.current.id, alasan: teks,
      });
      operasi.current = null;
      if (terpasang.current) onSelesai();
    } catch (e) {
      if (!hasilBelumPasti(e)) operasi.current = null;
      if (terpasang.current) setGalat(e instanceof TugasError ? e : new TugasError('GAGAL_INTERNAL', 500));
    } finally { if (terpasang.current) setSibuk(false); }
  };

  return <li>
    <div className={styles.aksi}>
      <span>{pemilik.nama}</span>
      {!buka && <Tombol varian="sekunder" aria-label={`Cabut kepemilikan ${pemilik.nama}`}
        onClick={() => setBuka(true)}>Cabut kepemilikan</Tombol>}
    </div>
    {buka && <form className={styles.keputusan} onSubmit={(e) => { e.preventDefault(); void cabut(); }}>
      <p className={styles.meta}>{TEKS_BANTU}</p>
      <Field label={`Alasan mencabut ${pemilik.nama}`} wajib bantuan="Singkat, tanpa nomor atau informasi kontak.">
        <textarea ref={alasanRef} value={alasan} required maxLength={240}
          onChange={(e) => setAlasan(e.target.value)} />
      </Field>
      {galat && <p role="alert" className={styles.galat}>{galat.message}</p>}
      <div className={styles.aksi}>
        <Tombol type="submit" varian="bahaya" memuat={sibuk} disabled={!alasan.trim()}>Cabut</Tombol>
        <Tombol varian="hantu" disabled={sibuk}
          onClick={() => { operasi.current = null; setBuka(false); setAlasan(''); setGalat(null); }}>Batal</Tombol>
      </div>
    </form>}
  </li>;
}

// Daftar akun pemilik yang sudah disetujui pada profil ini. Hanya pemeriksa yang menerima datanya.
export default function PemilikTerdaftarBagian({ daftar, onSelesai }: {
  daftar: PemilikTerdaftar[]; onSelesai: () => void;
}) {
  if (daftar.length === 0) return null;
  return <section className={styles.bagian} aria-label="Pemilik terdaftar">
    <h3>Pemilik terdaftar</h3>
    <ul className={styles.daftar}>
      {daftar.map((p) => <BarisPemilik key={p.id} pemilik={p} onSelesai={onSelesai} />)}
    </ul>
  </section>;
}
