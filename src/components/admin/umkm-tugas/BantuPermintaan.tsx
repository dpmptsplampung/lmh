'use client';

import { useEffect, useRef, useState } from 'react';
import Kartu from '@/components/ui/Kartu';
import Tombol from '@/components/ui/Tombol';
import Field from '@/components/ui/Field';
import { templatKodeTautan } from '@/lib/umkm-katalog/templat-whatsapp';
import type { DaftarTugas } from '@/lib/umkm-katalog/types';
import { waLink } from '@/lib/utils';
import { asalTautan } from './asal-tautan';
import { hasilBelumPasti, kirimTugas, tugasRequest, TugasError } from './api';
import type { HasilBantuan } from './permintaan-types';
import styles from './umkm-tugas.module.css';

const KOSONG = {
  nama_perusahaan: '', jabatan: '', nama_pemohon: '', kontak: '', teks: '', kategori: '', kabupaten_kota: '',
};
type Isian = typeof KOSONG;
type Pilihan = { id: string; nama: string };

// 12 karakter acak ditampilkan XXXX-XXXX-XXXX.
export const tampilKode = (kode: string) =>
  (kode.replace(/[^A-Za-z0-9]/g, '').toUpperCase().match(/.{1,4}/g) ?? []).join('-');

// Kode tautan hanya hidup di state komponen ini: tidak ke penyimpanan peramban, URL, atau konsol.
export default function BantuPermintaan({ onSelesai, onBatal }: {
  onSelesai: (permintaanId: string | null) => void; onBatal: () => void;
}) {
  const [isian, setIsian] = useState<Isian>(KOSONG);
  const [cari, setCari] = useState('');
  const [hasilCari, setHasilCari] = useState<Pilihan[] | null>(null);
  const [profil, setProfil] = useState<Pilihan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hasil, setHasil] = useState<HasilBantuan | null>(null);
  const [petugas, setPetugas] = useState('petugas UMKM DPMPTSP');
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState('');
  const operation = useRef<{ signature: string; id: string } | null>(null);
  const mounted = useRef(true);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    mounted.current = true; titleRef.current?.focus();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- asal tautan dibaca setelah komponen ada di peramban
    setOrigin(asalTautan());
    return () => { mounted.current = false; };
  }, []);

  const ubah = (kunci: keyof Isian, nilai: string) => {
    operation.current = null; setIsian((p) => ({ ...p, [kunci]: nilai }));
  };
  const cariProfil = async () => {
    if (cari.trim().length < 2) return;
    setError('');
    try {
      const data = await tugasRequest<DaftarTugas>(`/cari?q=${encodeURIComponent(cari.trim())}`);
      if (mounted.current) setHasilCari(data.items.filter((t) => t.jenis === 'profil' && t.status === 'terbit')
        .map((t) => ({ id: t.id, nama: t.nama })));
    } catch (e) { if (mounted.current) setError(e instanceof TugasError ? e.message : 'Pencarian belum berhasil.'); }
  };
  const kirim = async () => {
    if (busy || !profil) return;
    setBusy(true); setError('');
    const body = {
      nama_perusahaan: isian.nama_perusahaan.trim(), jabatan: isian.jabatan.trim(),
      nama_pemohon: isian.nama_pemohon.trim(), kontak: isian.kontak.trim(), teks: isian.teks.trim(),
      kategori: isian.kategori.trim(), kabupaten_kota: isian.kabupaten_kota.trim() || null, profil_id: profil.id,
    };
    const signature = JSON.stringify(body);
    if (operation.current?.signature !== signature) operation.current = { signature, id: crypto.randomUUID() };
    try {
      const data = await kirimTugas<HasilBantuan>('/permintaan/bantu', { ...body, operasi_id: operation.current.id });
      operation.current = null;
      // Nama petugas untuk teks pesan; bila gagal dimuat, sapaan umum dipakai.
      const detail = await tugasRequest<{ pemeriksa_nama?: string }>(`/permintaan/${data.id}`).catch(() => null);
      if (mounted.current) { if (detail?.pemeriksa_nama) setPetugas(detail.pemeriksa_nama); setHasil(data); }
    } catch (e) {
      if (!hasilBelumPasti(e)) operation.current = null;
      if (mounted.current) setError(e instanceof TugasError ? e.message : 'Hasil belum pasti. Coba kembali.');
    } finally { if (mounted.current) setBusy(false); }
  };

  if (hasil) {
    const kode = hasil.kode_tautan ? tampilKode(hasil.kode_tautan) : null;
    const pesan = kode ? templatKodeTautan({
      namaPemohon: isian.nama_pemohon, namaPetugas: petugas, kodeTautan: kode, tautanMasuk: `${origin}/me/umkm`,
    }) : '';
    const salin = async (teks: string, label: string) => {
      try { await navigator.clipboard.writeText(teks); if (mounted.current) setCopied(`${label} disalin.`); }
      catch { if (mounted.current) setCopied('Belum dapat menyalin. Pilih teks dan salin manual.'); }
    };
    return <Kartu><div className={styles.form}>
      <h2 ref={titleRef} tabIndex={-1}>Permintaan bantuan dicatat</h2>
      <p>Kode permintaan: <strong>{hasil.kode}</strong></p>
      {kode ? <>
        <p className={styles.peringatan} role="alert">Kode tautan hanya tampil sekarang. Setelah layar ini ditutup,
          kode tidak bisa dilihat lagi. Salin atau kirim ke pemohon sebelum menutup.</p>
        <p className={styles.kode} aria-label="Kode tautan">{kode}</p>
        <p className={styles.template}>{pesan}</p>
        <div className={styles.aksi}>
          <Tombol varian="sekunder" onClick={() => void salin(kode, 'Kode')}>Salin kode</Tombol>
          <Tombol varian="sekunder" onClick={() => void salin(pesan, 'Pesan')}>Salin pesan</Tombol>
          <Tombol href={waLink(isian.kontak, pesan)} eksternal target="_blank" rel="noopener noreferrer"
            varian="sekunder">Kirim lewat WhatsApp</Tombol>
        </div>
        <p role="status">{copied}</p>
      </> : <p className={styles.peringatan}>Kode tautan tidak tersedia lagi.
        Bila belum terkirim, buat permintaan bantuan baru.</p>}
      <Tombol onClick={() => onSelesai(hasil.id)}>Tutup dan buka permintaan</Tombol>
    </div></Kartu>;
  }

  const lengkap = profil && Object.values(isian).slice(0, 5).every((v) => v.trim()) && isian.kategori.trim();
  return <Kartu><form className={styles.form} onSubmit={(e) => { e.preventDefault(); void kirim(); }}>
    <h2 ref={titleRef} tabIndex={-1}>Bantu pemohon tanpa akun</h2>
    <p className={styles.meta}>Catat permintaan atas nama pemohon. Nomor UMKM baru terbuka setelah pemohon masuk
      dan memasukkan kode tautan.</p>
    {error && <p role="alert">{error}</p>}
    <div className={styles.bidang}>
      <Field label="Nama perusahaan" wajib><input value={isian.nama_perusahaan} maxLength={200}
        onChange={(e) => ubah('nama_perusahaan', e.target.value)} /></Field>
      <Field label="Jabatan pemohon" wajib><input value={isian.jabatan} maxLength={200}
        onChange={(e) => ubah('jabatan', e.target.value)} /></Field>
      <Field label="Nama pemohon" wajib><input value={isian.nama_pemohon} maxLength={200}
        onChange={(e) => ubah('nama_pemohon', e.target.value)} /></Field>
      <Field label="Nomor HP pemohon" wajib><input type="tel" inputMode="tel" value={isian.kontak} maxLength={20}
        onChange={(e) => ubah('kontak', e.target.value)} /></Field>
      <Field label="Kebutuhan" wajib className={styles.lebar} bantuan="Singkat, paling banyak 200 karakter.">
        <textarea value={isian.teks} maxLength={200} onChange={(e) => ubah('teks', e.target.value)} /></Field>
      <Field label="Kategori" wajib><input value={isian.kategori} maxLength={100}
        onChange={(e) => ubah('kategori', e.target.value)} /></Field>
      <Field label="Kabupaten/kota"><input value={isian.kabupaten_kota} maxLength={100}
        onChange={(e) => ubah('kabupaten_kota', e.target.value)} /></Field>
    </div>
    <section className={styles.bagian} aria-label="UMKM yang diminta">
      <h3>UMKM yang diminta</h3>
      <Field label="Cari nama UMKM" bantuan="Minimal 2 karakter. Hanya profil terbit.">
        <input type="search" value={cari} maxLength={200}
          onChange={(e) => { setCari(e.target.value); setHasilCari(null); }} />
      </Field>
      <div className={styles.aksi}><Tombol varian="sekunder" disabled={cari.trim().length < 2}
        onClick={() => void cariProfil()}>Cari UMKM</Tombol></div>
      {hasilCari && (hasilCari.length === 0 ? <p>UMKM terbit tidak ditemukan.</p> : <ul className={styles.daftar}>
        {hasilCari.map((p) => <li key={p.id} className={styles.baris}>
          <strong>{p.nama}</strong>
          <Tombol varian="sekunder" aria-pressed={profil?.id === p.id}
            onClick={() => { operation.current = null; setProfil(p); }}
            aria-label={`Pilih ${p.nama}`}>{profil?.id === p.id ? 'Dipilih' : 'Pilih'}</Tombol>
        </li>)}
      </ul>)}
      {profil && <p>UMKM dipilih: <strong>{profil.nama}</strong></p>}
    </section>
    <div className={styles.aksi}>
      <Tombol type="submit" memuat={busy} disabled={!lengkap}>Catat permintaan</Tombol>
      <Tombol varian="hantu" disabled={busy} onClick={onBatal}>Batal</Tombol>
    </div>
  </form></Kartu>;
}
