'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ClipboardCheck } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Kartu from '@/components/ui/Kartu';
import Tombol from '@/components/ui/Tombol';
import StatusKosong from '@/components/ui/StatusKosong';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import Galat from '@/components/ui/Galat';
import Field from '@/components/ui/Field';
import type { DaftarTugas, Detail, DetailPesan, DetailLaporan, Mutasi, TugasCampuran } from '@/lib/umkm-katalog/types';
import { formatTanggal } from '@/lib/utils';
import { hasilBelumPasti, kirimTugas, tugasRequest, TugasError } from './api';
import DetailTugas from './DetailTugas';
import DetailPekerjaan from './DetailPekerjaan';
import ProfilForm from './ProfilForm';
import styles from './umkm-tugas.module.css';

function subscribeNetwork(listener: () => void) {
  window.addEventListener('online', listener); window.addEventListener('offline', listener);
  return () => { window.removeEventListener('online', listener); window.removeEventListener('offline', listener); };
}

export default function TugasUmkm() {
  const [list, setList] = useState<DaftarTugas | null>(null);
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [work, setWork] = useState<DetailPesan | DetailLaporan | null>(null);
  const [mode, setMode] = useState<'list' | 'detail' | 'work' | 'new' | 'edit'>('list');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<TugasError | null>(null);
  const offline = useSyncExternalStore(subscribeNetwork, () => !navigator.onLine, () => false);
  const [notice, setNotice] = useState('');
  const listRequest = useRef<AbortController | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const currentId = useRef<string | null>(null);
  const currentKind = useRef<TugasCampuran['jenis']>('profil');
  const claimOperation = useRef<{ signature: string; id: string } | null>(null);
  const returnFocus = useRef(false);
  const listHeading = useRef<HTMLDivElement>(null);

  const load = useCallback(async (cursor?: string) => {
    listRequest.current?.abort();
    const request = new AbortController(); listRequest.current = request;
    setLoading(true); setError(null); setList(null);
    try {
      const search = query.trim();
      const path = search ? `/cari?q=${encodeURIComponent(search)}` : '';
      const page = cursor ? `${search ? '&' : '?'}cursor=${encodeURIComponent(cursor)}` : '';
      const result = await tugasRequest<DaftarTugas>(`${path}${page}`, { signal: request.signal });
      if (!request.signal.aborted) setList(result);
    } catch (e) {
      if (!request.signal.aborted) setError(e instanceof TugasError ? e : new TugasError('GAGAL_INTERNAL', 500));
    } finally { if (!request.signal.aborted) setLoading(false); }
  }, [query]);

  useEffect(() => {
    if (query.trim().length === 1) return;
    const timer = query.trim() ? window.setTimeout(() => { void load(); }, 300) : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pemuatan awal dan pembatalan saat keluar
    if (timer === null) void load();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      listRequest.current?.abort(); detailRequest.current?.abort();
    };
  }, [load, query]);

  useLayoutEffect(() => {
    if (mode === 'list' && !loading && returnFocus.current && listHeading.current) {
      listHeading.current.focus(); returnFocus.current = false;
    }
  }, [mode, loading, list]);

  const open = async (id: string, claim = true) => {
    detailRequest.current?.abort();
    listRequest.current?.abort();
    const request = new AbortController(); detailRequest.current = request;
    currentId.current = id; currentKind.current = 'profil'; setWork(null);
    setDetail(null); setMode('detail'); setLoading(true); setError(null);
    try {
      let result = await tugasRequest<Detail>(`/${id}`, { signal: request.signal });
      if (request.signal.aborted) return;
      if (claim && !result.petugas_id) {
        const signature = JSON.stringify(['profil', id, result.versi]);
        if (claimOperation.current?.signature !== signature) {
          claimOperation.current = { signature, id: crypto.randomUUID() };
        }
        await kirimTugas<Mutasi>(`/${id}/ambil`, {
          expected_version: result.versi, operasi_id: claimOperation.current.id,
        }, request.signal);
        claimOperation.current = null;
        if (request.signal.aborted) return;
        result = await tugasRequest<Detail>(`/${id}`, { signal: request.signal });
      }
      if (!request.signal.aborted) setDetail(result);
    } catch (e) {
      if (!hasilBelumPasti(e)) claimOperation.current = null;
      if (!request.signal.aborted) setError(e instanceof TugasError ? e : new TugasError('GAGAL_INTERNAL', 500));
    } finally { if (!request.signal.aborted) setLoading(false); }
  };
  const openWork = async (jenis: 'pesan' | 'laporan', id: string, claim = true) => {
    detailRequest.current?.abort(); listRequest.current?.abort();
    const request = new AbortController(); detailRequest.current = request;
    currentId.current = id; currentKind.current = jenis;
    setWork(null); setDetail(null); setMode('work'); setLoading(true); setError(null);
    try {
      let result = await tugasRequest<DetailPesan | DetailLaporan>(`/${jenis}/${id}`, { signal: request.signal });
      if (request.signal.aborted) return;
      if (claim && !result.petugas_id) {
        const signature = JSON.stringify([jenis, id, result.versi]);
        if (claimOperation.current?.signature !== signature) {
          claimOperation.current = { signature, id: crypto.randomUUID() };
        }
        await kirimTugas(`/${jenis}/${id}/ambil`, {
          expected_version: result.versi, operasi_id: claimOperation.current.id,
        }, request.signal);
        claimOperation.current = null;
        if (request.signal.aborted) return;
        result = await tugasRequest<DetailPesan | DetailLaporan>(`/${jenis}/${id}`, { signal: request.signal });
      }
      if (!request.signal.aborted) setWork(result);
    } catch (e) {
      if (!hasilBelumPasti(e)) claimOperation.current = null;
      if (!request.signal.aborted) setError(e instanceof TugasError ? e : new TugasError('GAGAL_INTERNAL', 500));
    } finally { if (!request.signal.aborted) setLoading(false); }
  };
  const back = () => {
    detailRequest.current?.abort(); currentId.current = null; setDetail(null); setWork(null); setMode('list');
    returnFocus.current = true;
    void load();
  };
  const changed = async (result: Mutasi, completed = false) => {
    const photosPending = result.foto_publikasi?.status === 'tertunda';
    setNotice(photosPending ? 'Keputusan tersimpan. Sebagian foto belum tampil; coba lagi dari rincian profil.'
      : completed ? 'Keputusan tersimpan.' : 'Perubahan tersimpan.');
    if (completed && !photosPending) { back(); return; }
    await open(result.id, false);
  };
  const restricted = error && [401, 403, 503].includes(error.status);
  return <div className={styles.halaman}>
    <PageHeader title="Tugas UMKM" description="Periksa profil, pesan, dan laporan sesuai urutan. Tugas mendesak didahulukan.">
      {mode === 'list' && !loading && !error && <Tombol onClick={() => { listRequest.current?.abort(); setDetail(null); setMode('new'); }}>Tambah profil</Tombol>}
    </PageHeader>
    {notice && <p role="status" className={styles.meta}>{notice}</p>}
    {offline && <CatatanKeadaan jenis="info" judul="Sedang offline">Periksa koneksi sebelum mengambil tugas atau menyimpan keputusan.</CatatanKeadaan>}
    {!restricted && mode === 'list' && <Field label="Cari nama usaha"
      bantuan="Minimal 2 karakter. Pencarian mencakup semua status profil. Kosongkan untuk kembali ke antrean.">
      <input type="search" value={query} maxLength={200} onChange={(event) => {
        listRequest.current?.abort();
        setQuery(event.target.value); setList(null); setError(null);
        setLoading(event.target.value.trim().length !== 1);
      }} />
    </Field>}
    {mode === 'list' && query.trim().length === 1 && <p role="status">Ketik minimal 2 karakter untuk mencari.</p>}
    {error && (error.status === 503
      ? <CatatanKeadaan jenis="menunggu-migrasi" judul="Tugas UMKM belum tersedia" aksi={<Tombol varian="sekunder" onClick={back}>Coba lagi</Tombol>}>{error.message}</CatatanKeadaan>
      : error.status === 401 || error.status === 403
        ? <CatatanKeadaan jenis="lingkup" judul="Belum memiliki izin pemeriksa">{error.message}</CatatanKeadaan>
        : <Galat pesan={error.message} onRetry={() => {
          if (mode === 'detail' && currentId.current) void open(currentId.current, false);
          else if (mode === 'work' && currentId.current && currentKind.current !== 'profil') {
            void openWork(currentKind.current, currentId.current, false);
          } else back();
        }} />)}
    {loading && <p role="status" aria-live="polite">
      {mode === 'list' && query.trim() ? 'Mencari profil UMKM...' : 'Memuat tugas UMKM...'}
    </p>}
    {!restricted && !loading && mode === 'list' && list && <div ref={listHeading} tabIndex={-1}>
      <Kartu judul={query.trim() ? 'Hasil pencarian' : 'Daftar tugas'}
        aksi={<Tombol varian="hantu" onClick={() => load()}>Muat ulang</Tombol>}>
        {list.items.length === 0 ? <StatusKosong ikon={ClipboardCheck}
          judul={query.trim() ? 'Profil tidak ditemukan' : 'Belum ada tugas UMKM'}
          isi={query.trim() ? 'Coba nama usaha lain atau kosongkan pencarian untuk kembali ke antrean.'
            : 'Profil yang perlu diperiksa akan muncul di sini. Anda dapat menambahkan profil baru.'} />
          : <ol className={styles.daftar}>
          {list.items.map((task) => <li key={`${task.jenis}:${task.id}`}><div className={styles.baris}>
            <div className={styles.identitas}><strong>{task.nama}</strong>
              <span className={styles.meta}>{task.jenis === 'profil' ? 'Profil' : task.jenis === 'pesan' ? 'Pesan' : 'Laporan'}.
                {task.mendesak ? ' Mendesak. ' : ' '}{task.status}. Masuk {formatTanggal(task.dibuat_pada)}</span>
              {task.petugas_nama && <span className={styles.meta}>sedang dipegang {task.petugas_nama}</span>}
              {task.jenis === 'profil' && task.tanpa_nomor && <span className={styles.meta}>Belum ada WhatsApp</span>}
            </div>
            <Tombol varian="sekunder" onClick={() => task.jenis === 'profil'
              ? void open(task.id) : void openWork(task.jenis, task.id)}
              aria-label={`Periksa ${task.nama}`}>Periksa</Tombol>
          </div></li>)}
        </ol>}
        <div className={styles.aksi}>{list.next_cursor && <Tombol varian="sekunder" onClick={() => load(list.next_cursor!)}>Halaman berikutnya</Tombol>}{list.items.length > 0 && <Tombol varian="hantu" onClick={() => load()}>Ke awal daftar</Tombol>}</div>
      </Kartu>
    </div>}
    {!restricted && !loading && mode === 'detail' && detail && <DetailTugas key={`${detail.id}:${detail.versi}`} detail={detail} onChanged={changed} onEdit={() => setMode('edit')} onBack={back} onRefresh={() => void open(detail.id, false)} />}
    {!restricted && !loading && mode === 'work' && work && <DetailPekerjaan key={`${work.jenis}:${work.id}:${work.versi}`}
      detail={work} onBack={back} onRefresh={() => void openWork(work.jenis, work.id, false)}
      onProfile={(id) => void open(id)} onChanged={async (completed) => {
        if (completed) { setNotice(work.jenis === 'pesan' ? 'Pesan ditandai sudah dibalas.' : 'Laporan selesai.'); back(); }
        else await openWork(work.jenis, work.id, false);
      }} />}
    {!restricted && !loading && (mode === 'new' || mode === 'edit') && <ProfilForm key={mode === 'new' ? 'new' : detail?.id} detail={mode === 'edit' ? detail ?? undefined : undefined} onSaved={(result) => void changed(result)} onCancel={back} />}
    {!restricted && !loading && (mode === 'detail' || mode === 'work') && !detail && !work && error &&
      <Tombol varian="hantu" onClick={back}>Kembali ke daftar</Tombol>}
  </div>;
}
