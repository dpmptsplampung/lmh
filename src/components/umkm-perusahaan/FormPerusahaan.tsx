'use client';

import { useState } from 'react';
import Field from '@/components/ui/Field';
import Tombol from '@/components/ui/Tombol';
import styles from '@/components/umkm-katalog/katalog.module.css';
import { KatalogError, kirim } from './api';
import type { Perusahaan } from './types';

// Data perusahaan diisi sekali. Nama, email, dan HP pemohon diambil dari profil akun, bukan dari sini.
export default function FormPerusahaan({ onSimpan, onBatal }: {
  onSimpan: (perusahaan: Perusahaan) => void; onBatal?: () => void;
}) {
  const [nama, setNama] = useState('');
  const [jabatan, setJabatan] = useState('');
  const [setuju, setSetuju] = useState(false);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState('');
  const kirimForm = async () => {
    if (sibuk) return;
    setSibuk(true); setGalat('');
    try {
      const hasil = await kirim<Perusahaan>('/perusahaan', { nama: nama.trim(), jabatan: jabatan.trim(), setuju });
      onSimpan(hasil);
    } catch (e) {
      setGalat(e instanceof KatalogError ? e.message : 'Data belum tersimpan. Silakan coba lagi.');
    } finally { setSibuk(false); }
  };
  return <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void kirimForm(); }}>
    <p className={styles.keterangan}>
      Isi sekali saja. Nama, email, dan nomor HP Anda diambil dari profil akun.
    </p>
    {galat && <div role="alert" className={styles.galat}>{galat}</div>}
    <fieldset disabled={sibuk} className={styles.form}>
      <legend className="sr-only">Data perusahaan</legend>
      <Field label="Nama perusahaan" wajib><input autoComplete="organization" value={nama} maxLength={200}
        required onChange={(event) => setNama(event.target.value)} /></Field>
      <Field label="Jabatan Anda" wajib><input autoComplete="organization-title" value={jabatan} maxLength={200}
        required onChange={(event) => setJabatan(event.target.value)} /></Field>
      <label className={styles.centang}>
        <input type="checkbox" checked={setuju} required onChange={(event) => setSetuju(event.target.checked)} />
        <span>Saya setuju data ini dipakai petugas untuk memeriksa permintaan nomor UMKM.{' '}
          <a href="/kebijakan-privasi" target="_blank" rel="noopener noreferrer">Kebijakan Privasi</a></span>
      </label>
    </fieldset>
    <div className={styles.aksi}>
      <Tombol type="submit" memuat={sibuk} disabled={!setuju}>Simpan data perusahaan</Tombol>
      {onBatal && <Tombol varian="hantu" onClick={onBatal} disabled={sibuk}>Batal</Tombol>}
    </div>
  </form>;
}
