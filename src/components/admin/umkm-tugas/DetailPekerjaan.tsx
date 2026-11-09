'use client';

import { useEffect, useRef, useState } from 'react';
import Kartu from '@/components/ui/Kartu';
import Tombol from '@/components/ui/Tombol';
import type { DetailPesan, DetailLaporan, MutasiPekerjaan } from '@/lib/umkm-katalog/types';
import { formatTanggalWaktu, waLink } from '@/lib/utils';
import { ALASAN_LAPORAN } from '@/components/umkm-katalog/alasan';
import { hasilBelumPasti, kirimTugas, TugasError } from './api';
import styles from './umkm-tugas.module.css';

export default function DetailPekerjaan({ detail, onBack, onRefresh, onChanged, onProfile }: {
  detail: DetailPesan | DetailLaporan; onBack: () => void; onRefresh: () => void;
  onChanged: (completed: boolean) => Promise<void>; onProfile: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [origin, setOrigin] = useState('');
  const operation = useRef<{ signature: string; id: string } | null>(null);
  const mounted = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    mounted.current = true; heading.current?.focus();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- asal tautan dibaca hanya setelah komponen ada di peramban
    setOrigin(window.location.origin);
    return () => { mounted.current = false; };
  }, []);
  const profileUrl = detail.profil_id ? `${origin}/umkm/katalog/${detail.profil_id}` : `${origin}/umkm/katalog`;
  const template = detail.jenis === 'pesan'
    ? `Halo ${detail.nama_pengirim}, saya ${detail.pemeriksa_nama}, petugas UMKM DPMPTSP. `
      + `Berikut profil ${detail.profil_nama ?? 'UMKM di katalog'}: ${profileUrl}. `
      + 'Saat ini LMH belum membagikan nomor UMKM.' : '';

  const mutate = async (action: 'ambil' | 'selesai') => {
    if (busy) return;
    setBusy(true); setError('');
    const signature = JSON.stringify([detail.jenis, detail.id, detail.versi, action]);
    if (operation.current?.signature !== signature) operation.current = { signature, id: crypto.randomUUID() };
    try {
      await kirimTugas<MutasiPekerjaan>(`/${detail.jenis}/${detail.id}/${action}`, {
        expected_version: detail.versi, operasi_id: operation.current.id,
      });
      operation.current = null;
      if (mounted.current) await onChanged(action === 'selesai');
    } catch (e) {
      if (!hasilBelumPasti(e)) operation.current = null;
      if (mounted.current) setError(e instanceof TugasError ? e.message : 'Hasil belum pasti. Coba kembali.');
    } finally { if (mounted.current) setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(template); if (mounted.current) setCopied('Teks balasan disalin.'); }
    catch { if (mounted.current) setCopied('Belum dapat menyalin. Pilih teks balasan dan salin manual.'); }
  };

  return <Kartu><div className={styles.form}>
    <Tombol varian="hantu" onClick={onBack} disabled={busy}>Kembali ke daftar</Tombol>
    <h2 ref={heading} tabIndex={-1}>{detail.jenis === 'pesan' ? 'Pesan pengunjung' : 'Laporan pengunjung'}</h2>
    <p className={styles.meta}>{detail.mendesak ? 'Mendesak. ' : ''}
      Masuk {formatTanggalWaktu(detail.dibuat_pada)}. Status: {detail.status}.</p>
    <div className={styles.aksi}>
      <p>{detail.petugas_nama ? `sedang dipegang ${detail.petugas_nama}` : 'Belum dipegang petugas'}</p>
      {!detail.dipegang_saya && <Tombol varian="sekunder" memuat={busy} onClick={() => void mutate('ambil')}>
        {detail.petugas_id ? 'Ambil alih' : 'Ambil tugas'}
      </Tombol>}
      {detail.dipegang_saya && detail.status === 'baru' && <Tombol memuat={busy}
        onClick={() => void mutate('selesai')}>{detail.jenis === 'pesan' ? 'Tandai sudah dibalas' : 'Selesai'}</Tombol>}
    </div>
    {error && <div role="alert"><p>{error}</p>
      <Tombol varian="sekunder" onClick={onRefresh} disabled={busy}>Muat ulang tugas</Tombol>
    </div>}
    {detail.profil_id && <div className={styles.aksi}>
      <Tombol href={`/umkm/katalog/${detail.profil_id}`} target="_blank" rel="noopener noreferrer"
        varian="sekunder">Lihat profil publik (tab baru)</Tombol>
      <Tombol varian="sekunder" disabled={busy} onClick={() => onProfile(detail.profil_id!)}>
        Koreksi atau sembunyikan profil
      </Tombol>
    </div>}
    {detail.jenis === 'pesan' ? <>
      <dl className={styles.rincian}>
        <dt>Pengirim</dt><dd>{detail.nama_pengirim}</dd>
        <dt>Perusahaan</dt><dd>{detail.perusahaan}</dd>
        <dt>Kontak pengirim</dt><dd>{detail.nomor}</dd>
        <dt>Profil</dt><dd>{detail.profil_nama ?? 'Tidak merujuk profil terbit'}</dd>
        {detail.kata_kunci && <><dt>Kata kunci</dt><dd>{detail.kata_kunci}</dd></>}
        <dt>Pesan</dt><dd>{detail.pesan}</dd>
      </dl>
      <p className={styles.template}>{template}</p>
      <div className={styles.aksi}>
        <Tombol varian="sekunder" onClick={() => void copy()} disabled={!origin}>Salin teks balasan</Tombol>
        <Tombol href={waLink(detail.nomor, template)} target="_blank" rel="noopener noreferrer"
          varian="sekunder">Balas dari WhatsApp pribadi saya</Tombol>
      </div>
      <p className={styles.meta}>Tautan membuka WhatsApp Anda untuk menghubungi pengirim.
        Nomor UMKM tidak disertakan. Tandai sudah dibalas setelah Anda mengirim balasan.</p>
      <p role="status">{copied}</p>
    </> : <dl className={styles.rincian}>
      <dt>Profil</dt><dd>{detail.profil_nama ?? 'Profil belum terbit'}</dd>
      <dt>Alasan laporan</dt><dd>{detail.alasan ? ALASAN_LAPORAN[detail.alasan] : 'Belum tersedia'}</dd>
      <dt>Catatan</dt><dd>{detail.catatan || 'Tidak ada catatan tambahan'}</dd>
      {detail.foto_id && <><dt>Foto terkait</dt><dd>Foto dilampirkan pada laporan. Periksa melalui profil.</dd></>}
    </dl>}
  </div></Kartu>;
}
