'use client';

import { useEffect, useRef, useState } from 'react';
import Kartu from '@/components/ui/Kartu';
import Tombol from '@/components/ui/Tombol';
import Field from '@/components/ui/Field';
import Lencana from '@/components/ui/Lencana';
import { formatTanggal } from '@/lib/utils';
import { hasilBelumPasti, kirimTugas, TugasError } from './api';
import KeteranganPemilik from './KeteranganPemilik';
import type { DetailKlaim, MutasiKlaim, StatusPemilik } from '@/lib/umkm-katalog/types-g5';
import styles from './umkm-tugas.module.css';

const LABEL_STATUS_PEMILIK: Record<StatusPemilik, string> = {
  diajukan: 'Diajukan', disetujui: 'Disetujui', ditolak: 'Ditolak',
};

type Props = {
  detail: DetailKlaim; onBack: () => void; onRefresh: () => void; onProfil: (id: string) => void;
  onChanged: (pesan: string, tutup: boolean) => Promise<void>;
};

// Satu layar: profil, akun pengklaim, alasan, lalu Setujui (1 klik) atau Tolak (Tolak lalu Kirim).
export default function DetailKlaimLayar({ detail, onBack, onRefresh, onProfil, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TugasError | null>(null);
  const [reject, setReject] = useState(false);
  const [reason, setReason] = useState('');
  const operation = useRef<{ signature: string; id: string } | null>(null);
  const mounted = useRef(true);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    mounted.current = true; titleRef.current?.focus();
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { if (reject) reasonRef.current?.focus(); }, [reject]);

  const kirim = async (aksi: 'ambil' | 'putusan', body: Record<string, unknown>, berhasil: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(null);
    const signature = JSON.stringify([detail.id, detail.versi, aksi, body]);
    if (operation.current?.signature !== signature) operation.current = { signature, id: crypto.randomUUID() };
    try {
      await kirimTugas<MutasiKlaim>(`/klaim/${detail.id}/${aksi}`, {
        ...body, expected_version: detail.versi, operasi_id: operation.current.id,
      });
      operation.current = null;
      if (mounted.current) await berhasil();
    } catch (e) {
      if (!hasilBelumPasti(e)) operation.current = null;
      if (mounted.current) setError(e instanceof TugasError ? e : new TugasError('GAGAL_INTERNAL', 500));
    } finally { if (mounted.current) setBusy(false); }
  };
  const ambil = () => kirim('ambil', {}, () => onChanged('Klaim diambil.', false));
  const setujui = () => kirim('putusan', { keputusan: 'disetujui' },
    () => onChanged('Klaim disetujui. Pemilik kini dapat mengelola profil.', true));
  const tolak = () => kirim('putusan', { keputusan: 'ditolak', alasan: reason.trim() },
    () => onChanged('Klaim ditolak.', true));

  const terbuka = detail.status === 'diajukan';
  const pegang = detail.dipegang_saya;
  return <Kartu><div className={styles.form}>
    <div className={styles.aksi}>
      <Tombol varian="hantu" onClick={onBack}>Kembali ke daftar</Tombol>
      <Lencana>{LABEL_STATUS_PEMILIK[detail.status]}</Lencana>
    </div>
    <h2 ref={titleRef} tabIndex={-1}>Klaim profil {detail.profil_nama}</h2>
    <p className={styles.meta}>Masuk {formatTanggal(detail.dibuat_pada)}.</p>
    <div className={styles.aksi}>
      <p>{detail.petugas_nama ? `sedang dipegang ${detail.petugas_nama}` : 'Belum dipegang petugas'}</p>
      {!pegang && terbuka && <Tombol varian="sekunder" memuat={busy} onClick={() => void ambil()}>
        {detail.petugas_id ? 'Ambil alih' : 'Ambil tugas'}</Tombol>}
    </div>
    {error && <div role="alert"><p>{error.message}</p>
      <Tombol varian="sekunder" onClick={onRefresh}>Muat ulang tugas</Tombol></div>}
    <section className={styles.bagian} aria-label="Profil yang diklaim">
      <h3>Profil yang diklaim</h3>
      <p>{detail.profil_nama}</p>
      <Tombol varian="sekunder" onClick={() => onProfil(detail.profil_id)}>Lihat profil lengkap</Tombol>
    </section>
    <KeteranganPemilik pemilik={detail.pemilik} judul="Akun pengklaim" />
    <section className={styles.bagian} aria-label="Alasan klaim">
      <h3>Alasan klaim</h3>
      <p>{detail.alasan}</p>
      <p className={styles.meta}>Cocokkan akun dan alasan dengan profil sebelum menyetujui.</p>
    </section>
    {detail.alasan_tolak && <p className={styles.meta}>Alasan tolak: {detail.alasan_tolak}</p>}
    {pegang && terbuka && <section className={styles.bagian} aria-label="Keputusan klaim">
      <h3>Keputusan</h3>
      <div className={styles.aksi}>
        <Tombol memuat={busy} onClick={() => void setujui()}>Setujui</Tombol>
        <Tombol varian="bahaya" disabled={busy} onClick={() => setReject(true)}>Tolak</Tombol>
      </div>
      {reject && <form className={styles.keputusan} onSubmit={(e) => {
        e.preventDefault(); if (reason.trim()) void tolak();
      }}>
        <Field label="Alasan tolak" wajib bantuan="Singkat, tanpa nomor atau informasi kontak.">
          <textarea ref={reasonRef} value={reason} required maxLength={240}
            onChange={(e) => { operation.current = null; setReason(e.target.value); }} />
        </Field>
        <div className={styles.aksi}>
          <Tombol type="submit" varian="bahaya" memuat={busy}>Kirim penolakan</Tombol>
          <Tombol varian="hantu" disabled={busy}
            onClick={() => { operation.current = null; setReject(false); setReason(''); }}>Batal menolak</Tombol>
        </div>
      </form>}
    </section>}
  </div></Kartu>;
}
