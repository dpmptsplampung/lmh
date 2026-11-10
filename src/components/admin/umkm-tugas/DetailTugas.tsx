'use client';

import { useEffect, useRef, useState } from 'react';
import Kartu from '@/components/ui/Kartu';
import Tombol from '@/components/ui/Tombol';
import Field from '@/components/ui/Field';
import Lencana from '@/components/ui/Lencana';
import type { Detail, Foto, Mutasi } from '@/lib/umkm-katalog/types';
import { LABEL_OMZET, LABEL_TENAGA_KERJA, formatKapasitas } from '@/lib/umkm-katalog/taksonomi';
import { formatTanggal } from '@/lib/utils';
import { hasilBelumPasti, kirimTugas, TugasError } from './api';
import NomorTugas from './NomorTugas';
import KeteranganPemilik from './KeteranganPemilik';
import PemilikTerdaftarBagian from './PemilikTerdaftar';
import FotoKatalog from '@/components/umkm-katalog/FotoKatalog';
import styles from './umkm-tugas.module.css';

export default function DetailTugas({ detail, onChanged, onEdit, onBack, onRefresh }: {
  detail: Detail; onChanged: (value: Mutasi, completed?: boolean) => Promise<void>; onEdit: () => void; onBack: () => void; onRefresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TugasError | null>(null);
  const [reject, setReject] = useState(false);
  const [reason, setReason] = useState('');
  const [copied, setCopied] = useState('');
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(true);
  const operation = useRef<{ signature: string; id: string } | null>(null);
  useEffect(() => { mounted.current = true; titleRef.current?.focus(); return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (reject) reasonRef.current?.focus(); }, [reject]);

  const mutate = async (action: string, body: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true); setError(null);
    const signature = JSON.stringify([detail.id, detail.versi, action, body]);
    if (operation.current?.signature !== signature) operation.current = { signature, id: crypto.randomUUID() };
    try {
      const result = await kirimTugas<Mutasi>(`/${detail.id}/${action}`, {
        ...body, expected_version: detail.versi, operasi_id: operation.current.id,
      });
      operation.current = null;
      if (mounted.current) await onChanged(result, action === 'putusan' || action === 'selesai-mendesak');
    } catch (e) {
      if (!hasilBelumPasti(e)) operation.current = null;
      if (mounted.current) setError(e instanceof TugasError ? e : new TugasError('GAGAL_INTERNAL', 500));
    } finally { if (mounted.current) setBusy(false); }
  };
  const retryPhotos = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await kirimTugas(`/${detail.id}/foto-publikasi`, {});
      if (mounted.current) onRefresh();
    } catch (e) {
      if (mounted.current) setError(e instanceof TugasError ? e : new TugasError('GAGAL_INTERNAL', 500));
    } finally { if (mounted.current) setBusy(false); }
  };
  const warning = (field: string) => detail.peringatan_kontak.includes(field)
    ? <p className={styles.peringatan} role="alert">Informasi kontak ditemukan. Bersihkan bagian ini sebelum menerbitkan.</p> : null;
  const revision = detail.revisi;
  // Foto produk diikat ke produk lewat `produk_urutan` dan tidak masuk galeri profil.
  const profilePhotos = detail.foto.filter((f) => f.produk_urutan == null);
  const products = detail.produk ?? [];
  const productPhoto = (urutan: number): Foto | undefined => detail.foto.find((f) => f.produk_urutan === urutan);
  const publicationPending = (detail.foto_publikasi_tertunda ?? 0) > 0;
  const deletionPending = (detail.foto_hapus_tertunda ?? 0) > 0;
  const template = `Halo, saya petugas UMKM DPMPTSP Provinsi Lampung. Bolehkah nomor Anda kami tampilkan kepada perusahaan yang sudah kami periksa ketika layanan berbagi nomor tersedia? Izin dapat dicabut kapan saja. Saat ini nomor belum dibagikan melalui LMH.`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(template); if (mounted.current) setCopied('Template disalin.'); }
    catch { if (mounted.current) setCopied('Belum dapat menyalin. Pilih teks template dan salin manual.'); }
  };

  return <Kartu>
    <div className={styles.form}>
      <div className={styles.aksi}><Tombol varian="hantu" onClick={onBack}>Kembali ke daftar</Tombol><Lencana>{detail.status}</Lencana>{detail.mendesak && <Lencana nada="peringatan">Mendesak</Lencana>}</div>
      <h2 ref={titleRef} tabIndex={-1}>{revision.nama}</h2>
      <p className={styles.meta}>Masuk {formatTanggal(detail.dibuat_pada)}. Sumber: {detail.sumber === 'mandiri' ? 'Didaftarkan pemilik' : detail.sumber === 'loket' ? 'tamu loket' : detail.sumber === 'kurasi' ? 'data kurasi' : 'satudata'}.</p>
      {detail.pemilik && <KeteranganPemilik pemilik={detail.pemilik} />}
      <PemilikTerdaftarBagian daftar={detail.pemilik_terdaftar ?? []} onSelesai={onRefresh} />
      <div className={styles.aksi}>
        <p>{detail.petugas_nama ? `sedang dipegang ${detail.petugas_nama}` : 'Belum dipegang petugas'}</p>
        {!detail.dipegang_saya && <Tombol varian="sekunder" memuat={busy} onClick={() => mutate('ambil', {})}>{detail.petugas_id ? 'Ambil alih' : 'Ambil tugas'}</Tombol>}
        {detail.dipegang_saya && <Tombol varian="sekunder" onClick={onEdit} disabled={busy}>Perbaiki data</Tombol>}
      </div>
      {error && <div role="alert"><p>{error.message}</p><Tombol varian="sekunder" onClick={onRefresh}>Muat ulang tugas</Tombol></div>}
      {detail.tanpa_nomor && <p className={styles.peringatan}>Belum ada nomor WhatsApp. Profil tetap dapat diterbitkan.</p>}
      {detail.dipegang_saya && <section className={styles.bagian} aria-label="Keputusan profil">
          <h3>Keputusan profil</h3>
          {!revision.keputusan && detail.peringatan_kontak.length > 0 && <p className={styles.peringatan}>Terbitkan tersedia setelah informasi kontak yang ditandai dibersihkan.</p>}
          <div className={styles.aksi}>
            {detail.mendesak && <Tombol memuat={busy} onClick={() => mutate('selesai-mendesak', {})}>
              Selesaikan pemeriksaan mendesak
            </Tombol>}
            {!revision.keputusan && <>
            <Tombol memuat={busy} disabled={detail.peringatan_kontak.length > 0 || detail.status === 'disembunyikan'} onClick={() => mutate('putusan', { keputusan: 'terbit' })}>Terbitkan</Tombol>
            <Tombol varian="bahaya" disabled={busy} onClick={() => setReject(true)}>Tolak</Tombol>
            </>}
            <Tombol varian="sekunder" disabled={busy} onClick={() => mutate('visibilitas', { aksi: detail.status === 'disembunyikan' ? 'pulihkan' : 'sembunyikan' })}>{detail.status === 'disembunyikan' ? 'Pulihkan profil' : 'Sembunyikan profil'}</Tombol>
          </div>
          {detail.status === 'disembunyikan' && <p>Pulihkan profil terlebih dahulu, lalu periksa kembali sebelum diterbitkan.</p>}
          {!revision.keputusan && reject && <form className={styles.keputusan} onSubmit={(e) => { e.preventDefault(); if (reason.trim()) void mutate('putusan', { keputusan: 'ditolak', alasan: reason.trim() }); }}>
            <Field label="Alasan tolak" wajib bantuan="Singkat, tanpa nomor atau informasi kontak."><textarea ref={reasonRef} value={reason} onChange={(e) => { operation.current = null; setReason(e.target.value); }} required maxLength={240} /></Field>
            <div className={styles.aksi}><Tombol type="submit" varian="bahaya" memuat={busy}>Kirim penolakan</Tombol><Tombol varian="hantu" disabled={busy} onClick={() => { operation.current = null; setReject(false); setReason(''); }}>Batal menolak</Tombol></div>
          </form>}
      </section>}
      <dl className={styles.rincian}>
        <dt>Nama usaha</dt><dd>{revision.nama}{warning('nama')}</dd>
        <dt>Jenis</dt><dd>{revision.jenis}{warning('jenis')}</dd>
        <dt>Kategori</dt><dd>{revision.kategori}{warning('kategori')}</dd>
        {revision.spesifik && <><dt>Spesifik</dt><dd>{revision.spesifik}{warning('spesifik')}</dd></>}
        <dt>Kabupaten/kota</dt><dd>{revision.kabupaten_kota}{warning('kabupaten_kota')}</dd>
        <dt>Kecamatan</dt><dd>{revision.kecamatan || 'Belum diisi'}{warning('kecamatan')}</dd>
        <dt>Deskripsi</dt><dd>{revision.deskripsi || 'Belum diisi'}{warning('deskripsi')}</dd>
        <dt>Alamat privat</dt><dd>{revision.alamat || 'Belum diisi'}{warning('alamat')}</dd>
        <dt>Nama pemilik</dt><dd>{revision.nama_pemilik || 'Belum diisi'} <Lencana>Tertutup</Lencana></dd>
        <dt>Bentuk usaha</dt><dd>{revision.bentuk_usaha || 'Belum diisi'}</dd>
        <dt>Mulai usaha</dt><dd>{revision.tahun_mulai || 'Belum diisi'}</dd>
        <dt>Omzet per tahun</dt><dd>{revision.omzet_rentang ? LABEL_OMZET[revision.omzet_rentang] ?? revision.omzet_rentang : 'Belum diisi'}</dd>
        <dt>Tenaga kerja</dt><dd>{revision.tenaga_kerja_rentang ? LABEL_TENAGA_KERJA[revision.tenaga_kerja_rentang] ?? revision.tenaga_kerja_rentang : 'Belum diisi'}</dd>
        <dt>NIB</dt><dd>{revision.memiliki_nib == null ? 'Belum diketahui' : revision.memiliki_nib ? 'Ya' : 'Tidak. NIB gratis dan dapat diurus lewat Helpdesk OSS DPMPTSP. Profil tetap dapat tampil.'}</dd>
        {revision.instagram && <><dt>Instagram</dt><dd><a href={revision.instagram} target="_blank" rel="noopener noreferrer">Lihat Instagram</a>{warning('instagram')}</dd></>}
        {revision.tiktok && <><dt>TikTok</dt><dd><a href={revision.tiktok} target="_blank" rel="noopener noreferrer">Lihat TikTok</a>{warning('tiktok')}</dd></>}
      </dl>
      <section className={styles.bagian} aria-label="Foto usaha">
        <h3>Foto usaha</h3>
        {(publicationPending || deletionPending) && <div className={styles.peringatan} role="status">
          {publicationPending && <p>
            Keputusan terbit tersimpan. Sebagian foto belum dapat ditampilkan kepada pengunjung.
          </p>}
          {deletionPending && <p>Sebagian salinan foto yang disembunyikan belum dapat dibersihkan.</p>}
          {detail.dipegang_saya && <Tombol varian="sekunder" memuat={busy} onClick={() => void retryPhotos()}>
            {publicationPending && deletionPending ? 'Coba lagi memproses foto publik'
              : deletionPending ? 'Coba lagi membersihkan foto publik' : 'Coba lagi menampilkan foto publik'}
          </Tombol>}
        </div>}
        {warning('foto')}
        <p className={styles.meta}>Periksa juga apakah ada nomor atau informasi kontak tertulis pada foto.</p>
        {profilePhotos.length === 0 ? <p>Belum ada foto.</p> : <div className={styles.foto}>
          {profilePhotos.map((photo, index) => <figure key={photo.id}>
            <FotoKatalog key={`${photo.id}:${photo.tersembunyi}`}
              src={photo.asal === 'unggahan' ? `/api/admin/umkm-tugas/${detail.id}/foto/${photo.id}` : photo.url}
              alt={`Foto ${index + 1} ${revision.nama}`} />
            <figcaption>{photo.tersembunyi ? 'Foto disembunyikan' : photo.perlu_review ? 'Menunggu pemeriksaan' : 'Sudah diperiksa'}{photo.utama ? ' ' : ''}{photo.utama && <Lencana>Foto utama</Lencana>}</figcaption>
            {detail.dipegang_saya && <Tombol varian="sekunder" disabled={busy} onClick={() => mutate('visibilitas', { aksi: photo.tersembunyi ? 'pulihkan' : 'sembunyikan', foto_id: photo.id })}>{photo.tersembunyi ? 'Pulihkan' : 'Sembunyikan'} foto {index + 1}</Tombol>}
          </figure>)}
        </div>}
      </section>
      <section className={styles.bagian} aria-label="Produk">
        <h3>Produk</h3>
        {warning('produk')}
        {products.length === 0 ? <p>Belum ada produk.</p> : <div className={styles.foto}>
          {products.map((p) => {
            const photo = productPhoto(p.urutan);
            return <figure key={p.urutan}>
              <strong>{p.nama}</strong>
              {p.keterangan && <span>{p.keterangan}</span>}
              {p.kapasitas_jumlah != null && p.kapasitas_satuan && p.kapasitas_periode &&
                <span>{formatKapasitas({ kapasitas_jumlah: p.kapasitas_jumlah, kapasitas_satuan: p.kapasitas_satuan,
                  kapasitas_periode: p.kapasitas_periode })}</span>}
              {photo ? <>
                <FotoKatalog key={`${photo.id}:${photo.tersembunyi}`}
                  src={photo.asal === 'unggahan' ? `/api/admin/umkm-tugas/${detail.id}/foto/${photo.id}` : photo.url}
                  alt={`Foto produk: ${p.nama}`} />
                <figcaption>{photo.tersembunyi ? 'Foto disembunyikan' : photo.perlu_review ? 'Menunggu pemeriksaan' : 'Sudah diperiksa'}</figcaption>
                {detail.dipegang_saya && <Tombol varian="sekunder" disabled={busy} onClick={() => mutate('visibilitas', { aksi: photo.tersembunyi ? 'pulihkan' : 'sembunyikan', foto_id: photo.id })}>{photo.tersembunyi ? 'Pulihkan' : 'Sembunyikan'} foto produk: {p.nama}</Tombol>}
              </> : <figcaption>Tanpa foto</figcaption>}
            </figure>;
          })}
        </div>}
      </section>
      {detail.dipegang_saya && <section className={styles.bagian} aria-label="Izin nomor">
          <h3>Nomor dan izin UMKM</h3>
          <p>Status izin: {detail.izin_status ?? 'belum dicatat'}. Nomor belum dibagikan kepada pengunjung atau perusahaan.</p>
          {!busy && (!revision.keputusan || detail.mendesak) &&
            <NomorTugas key={`${detail.id}:${detail.versi}`} id={detail.id} />}
          <div className={styles.aksi}>
            <Tombol varian="sekunder" disabled={busy || detail.tanpa_nomor} onClick={() => mutate('izin', { status: 'diberikan' })}>Izin diberikan</Tombol>
            <Tombol varian="sekunder" disabled={busy || detail.tanpa_nomor} onClick={() => mutate('izin', { status: 'dicabut' })}>Izin dicabut</Tombol>
          </div>
          <p className={styles.template}>{template}</p>
          <div className={styles.aksi}><Tombol varian="sekunder" onClick={copy}>Salin template izin</Tombol><span role="status">{copied}</span></div>
      </section>}
    </div>
  </Kartu>;
}
