'use client';

import { useState } from 'react';
import { Upload } from 'lucide-react';
import Field from '@/components/ui/Field';
import Tombol from '@/components/ui/Tombol';
import { MIME_GAMBAR, periksaBerkasGambar } from '../_logika/gambar';
import type { IsianGambar } from '../_hook/apiIpro';
import styles from '../../FormIpro.module.css';

export interface PropsTambahGambar {
  sibuk: boolean;
  tampilUtama: boolean;
  utamaAwal: boolean;
  onTambah: (berkas: File, isian: IsianGambar) => Promise<boolean>;
}

const atauNull = (v: string) => (v.trim() === '' ? null : v.trim());

export default function TambahGambar({ sibuk, tampilUtama, utamaAwal, onTambah }: PropsTambahGambar) {
  const [berkas, setBerkas] = useState<File | null>(null);
  const [alt, setAlt] = useState('');
  const [altEn, setAltEn] = useState('');
  const [keterangan, setKeterangan] = useState('');
  const [utama, setUtama] = useState(utamaAwal);
  const [galat, setGalat] = useState<{ berkas?: string; alt?: string }>({});
  const [ulang, setUlang] = useState(0);

  const kirim = async (e: React.FormEvent) => {
    e.preventDefault();
    const g: { berkas?: string; alt?: string } = {};
    if (!berkas) g.berkas = 'Pilih berkas gambar terlebih dahulu.';
    else { const m = periksaBerkasGambar(berkas); if (m) g.berkas = m; }
    if (alt.trim().length < 3 || alt.trim().length > 200) g.alt = 'Teks alternatif wajib diisi, 3-200 karakter.';
    setGalat(g);
    if (g.berkas || g.alt || !berkas) return;
    const ok = await onTambah(berkas, { alt: alt.trim(), alt_en: atauNull(altEn), keterangan: atauNull(keterangan), utama: tampilUtama ? utama : true });
    if (ok) { setBerkas(null); setAlt(''); setAltEn(''); setKeterangan(''); setUtama(false); setUlang((n) => n + 1); }
  };

  return (
    <form className={styles.tambahGambar} onSubmit={kirim} noValidate aria-label="Tambah gambar">
      <h3 className={styles.subjudul}>Tambah gambar</h3>
      <Field label="Berkas gambar" wajib galat={galat.berkas} bantuan="JPG, PNG, atau WebP, maksimal 8 MB. Gambar dikompres ke WebP dan metadata lokasi dibuang.">
        <input key={ulang} type="file" accept={MIME_GAMBAR.join(',')} disabled={sibuk} onChange={(e) => setBerkas(e.target.files?.[0] ?? null)} />
      </Field>
      <Field label="Teks alternatif" wajib galat={galat.alt} bantuan="Jelaskan isi gambar untuk pembaca layar (3-200 karakter).">
        <input value={alt} maxLength={200} disabled={sibuk} onChange={(e) => setAlt(e.target.value)} />
      </Field>
      <Field label="Teks alternatif (Inggris)"><input value={altEn} maxLength={200} disabled={sibuk} onChange={(e) => setAltEn(e.target.value)} /></Field>
      <Field label="Keterangan"><input value={keterangan} maxLength={300} disabled={sibuk} onChange={(e) => setKeterangan(e.target.value)} /></Field>
      {tampilUtama && (
        <label className={styles.centang}>
          <input type="checkbox" checked={utama} disabled={sibuk} onChange={(e) => setUtama(e.target.checked)} />
          Jadikan gambar utama
        </label>
      )}
      <div className={styles.aksiBaris}>
        <Tombol type="submit" ikon={Upload} memuat={sibuk}>Unggah gambar</Tombol>
      </div>
    </form>
  );
}
