'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import PageHeader from '@/components/layout/PageHeader';
import Kartu from '@/components/ui/Kartu';
import Tombol from '@/components/ui/Tombol';
import Field from '@/components/ui/Field';
import Galat from '@/components/ui/Galat';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import type { DaftarProfilPengawasan, ProfilPengawasan, RingkasanPengawasan } from '@/lib/umkm-katalog/types';
import { PengawasanError, pengawasanRequest } from './api';
import JejakKerja from './JejakKerja';
import TindakanDarurat from './TindakanDarurat';
import TahanPermintaan from './TahanPermintaan';
import { LABEL_PERMINTAAN, type RujukanPermintaan, type StatusPermintaan } from './permintaan-types';
import styles from './pengawasan.module.css';

function duration(seconds: number | null) {
  if (seconds === null) return 'Belum ada keputusan selesai';
  if (seconds < 60) return `${Math.round(seconds)} detik`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} menit`;
  return `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(seconds / 3600)} jam`;
}

export default function PengawasanUmkm() {
  const [summary, setSummary] = useState<RingkasanPengawasan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<PengawasanError | null>(null);
  const [query, setQuery] = useState('');
  const [profiles, setProfiles] = useState<DaftarProfilPengawasan | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [selected, setSelected] = useState<ProfilPengawasan | null>(null);
  const [action, setAction] = useState<'sembunyikan' | 'catat_pencabutan'>('sembunyikan');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [tahan, setTahan] = useState<RujukanPermintaan | null>(null);
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const summaryRequest = useRef<AbortController | null>(null);
  const searchRequest = useRef<AbortController | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [notice]);
  const load = useCallback(async () => {
    summaryRequest.current?.abort();
    const controller = new AbortController(); summaryRequest.current = controller;
    setLoading(true); setError(null); setSummary(null);
    try {
      const result = await pengawasanRequest<RingkasanPengawasan>('', { signal: controller.signal });
      if (!controller.signal.aborted) setSummary(result);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof PengawasanError
        ? e : new PengawasanError('GAGAL_INTERNAL', 500));
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ringkasan awal dari server
    void load();
    return () => { summaryRequest.current?.abort(); searchRequest.current?.abort(); };
  }, [load]);
  const search = async (cursor?: string) => {
    if (query.trim().length < 2) return;
    searchRequest.current?.abort();
    const controller = new AbortController(); searchRequest.current = controller;
    setSearching(true); setSearchError(''); setProfiles(null);
    const params = new URLSearchParams({ q: query.trim() });
    if (cursor) params.set('cursor', cursor);
    try {
      const result = await pengawasanRequest<DaftarProfilPengawasan>(`/cari?${params}`, { signal: controller.signal });
      if (!controller.signal.aborted) setProfiles(result);
    } catch (e) {
      if (!controller.signal.aborted) setSearchError(e instanceof PengawasanError ? e.message : 'Pencarian belum berhasil.');
    } finally { if (!controller.signal.aborted) setSearching(false); }
  };
  const emergency = (profile: ProfilPengawasan, nextAction: typeof action) => {
    setNotice(''); setSelected(profile); setAction(nextAction); setDialogOpen(true);
  };
  const restricted = error && [401, 403, 503].includes(error.status);
  return <div className={styles.halaman}>
    <PageHeader title="Pengawasan UMKM"
      description="Pantau antrean dan jejak kerja. Tindakan darurat diteruskan kepada pemeriksa UMKM.">
      <Tombol varian="sekunder" onClick={() => { void load(); setRefresh((value) => value + 1); }}>Muat ulang</Tombol>
    </PageHeader>
    {notice && <p ref={noticeRef} role="status" tabIndex={-1}>{notice}</p>}
    {loading && <p role="status">Memuat ringkasan...</p>}
    {error && (restricted ? <CatatanKeadaan jenis={error.status === 503 ? 'menunggu-migrasi' : 'lingkup'}
      judul={error.status === 503 ? 'Pengawasan UMKM belum tersedia' : 'Akses pengawasan terbatas'}
      aksi={<Tombol varian="sekunder" onClick={() => void load()}>Coba lagi</Tombol>}>{error.message}</CatatanKeadaan>
      : <Galat pesan={error.message} onRetry={() => void load()} />)}
    {summary && <Kartu judul="Ringkasan">
      <dl className={styles.angka}>
        {Object.entries({ 'Profil diajukan': summary.profil.diajukan, 'Profil terbit': summary.profil.terbit,
          'Profil disembunyikan': summary.profil.disembunyikan, 'Profil ditolak': summary.profil.ditolak,
          'Tugas terbuka': summary.tugas_terbuka, Mendesak: summary.mendesak,
          'Pesan baru': summary.pesan.baru, 'Pesan ditangani': summary.pesan.ditangani,
          'Laporan terbuka': summary.laporan_terbuka,
        }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{new Intl.NumberFormat('id-ID').format(value)}</dd></div>)}
      </dl>
      <dl className={styles.waktu}>
        <div><dt>Rata-rata pemeriksaan profil</dt><dd>{duration(summary.rata_pemeriksaan_detik)}</dd></div>
        <div><dt>Rata-rata balasan pertama</dt><dd>{summary.rata_balasan_pertama_detik === null
          ? 'Belum ada pesan dibalas' : duration(summary.rata_balasan_pertama_detik)}</dd></div>
      </dl>
      <p className={styles.meta}>Waktu dihitung dari pekerjaan yang sudah ditangani.</p>
    </Kartu>}
    {summary?.permintaan && <Kartu judul="Permintaan kontak">
      <dl className={styles.angka}>
        {(Object.keys(LABEL_PERMINTAAN) as StatusPermintaan[]).map((status) => <div key={status}>
          <dt>{LABEL_PERMINTAAN[status]}</dt>
          <dd>{new Intl.NumberFormat('id-ID').format(summary.permintaan![status] ?? 0)}</dd>
        </div>)}
      </dl>
      <dl className={styles.waktu}>
        <div><dt>Rata-rata lama sampai keputusan</dt><dd>{summary.rata_keputusan_detik == null
          ? 'Belum ada keputusan' : duration(summary.rata_keputusan_detik)}</dd></div>
      </dl>
      <p className={styles.meta}>Layar ini tidak menampilkan nomor UMKM atau data pemohon.</p>
    </Kartu>}
    {!restricted && <>
      <Kartu judul="Tindakan darurat">
        <p>Temukan profil dengan nama usaha yang pernah terbit. Nomor dan isi formulir tidak ditampilkan di sini.</p>
        <form className={styles.pencarian} onSubmit={(event) => { event.preventDefault(); void search(); }}>
          <Field label="Cari profil untuk tindakan darurat" bantuan="Minimal 2 karakter nama usaha.">
            <input type="search" value={query} minLength={2} maxLength={100} onChange={(event) => {
              searchRequest.current?.abort(); setSearching(false); setProfiles(null); setSearchError('');
              setQuery(event.target.value);
            }} />
          </Field>
          <Tombol type="submit" memuat={searching} disabled={query.trim().length < 2}>Cari profil</Tombol>
        </form>
        {searching && <p role="status">Mencari profil...</p>}
        {searchError && <Galat pesan={searchError} onRetry={() => void search()} />}
        {profiles && (profiles.items.length === 0 ? <p>Profil tidak ditemukan. Coba nama usaha lain.</p>
          : <ul className={styles.daftar}>
            {profiles.items.map((profile) => <li key={profile.id} className={styles.profil}>
              <div><strong>{profile.nama}</strong><p className={styles.meta}>Status: {profile.status}</p></div>
              <div className={styles.aksi}>
                {profile.status === 'terbit' && <Tombol varian="bahaya"
                  aria-label={`Sembunyikan ${profile.nama}`} onClick={() => emergency(profile, 'sembunyikan')}>
                  Sembunyikan
                </Tombol>}
                <Tombol varian="sekunder" aria-label={`Catat pencabutan izin ${profile.nama}`}
                  onClick={() => emergency(profile, 'catat_pencabutan')}>Catat pencabutan</Tombol>
              </div>
            </li>)}
          </ul>)}
        {profiles?.next_cursor && <Tombol varian="sekunder" onClick={() => void search(profiles.next_cursor!)}>
          Profil berikutnya
        </Tombol>}
      </Kartu>
      <JejakKerja refresh={refresh} onTahan={(p) => { setNotice(''); setTahan(p); }} />
    </>}
    {tahan && <TahanPermintaan key={`${tahan.id}:${tahan.versi}`} terbuka permintaan={tahan}
      onTutup={() => setTahan(null)} onSaved={() => {
        setTahan(null); setNotice('Permintaan ditahan. Pemeriksa UMKM akan melihatnya sebagai mendesak.');
        setRefresh((value) => value + 1); void load();
      }} />}
    {selected && <TindakanDarurat key={`${selected.id}:${selected.versi}:${action}`} terbuka={dialogOpen}
      profil={selected} aksi={action} onTutup={() => setDialogOpen(false)} onSaved={(result) => {
        setDialogOpen(false);
        setNotice((result.foto_publikasi?.hapus_tertunda ?? 0) > 0
          ? 'Profil sudah berhenti tampil. Salinan foto akan dibersihkan petugas.'
          : 'Tindakan tersimpan dan masuk ke tugas pemeriksa.');
        setProfiles((previous) => previous ? { ...previous,
          items: previous.items.map((item) => item.id === result.id
            ? { ...item, status: result.status, versi: result.versi } : item),
        } : null);
        setRefresh((value) => value + 1); void load();
      }} />}
  </div>;
}
