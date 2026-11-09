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
import type { DaftarTugas, Detail, Mutasi } from '@/lib/umkm-katalog/types';
import { formatTanggal } from '@/lib/utils';
import { kirimTugas, tugasRequest, TugasError } from './api';
import DetailTugas from './DetailTugas';
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
  const [mode, setMode] = useState<'list' | 'detail' | 'new' | 'edit'>('list');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<TugasError | null>(null);
  const offline = useSyncExternalStore(subscribeNetwork, () => !navigator.onLine, () => false);
  const [notice, setNotice] = useState('');
  const listRequest = useRef<AbortController | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const currentId = useRef<string | null>(null);
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
    currentId.current = id;
    setDetail(null); setMode('detail'); setLoading(true); setError(null);
    try {
      let result = await tugasRequest<Detail>(`/${id}`, { signal: request.signal });
      if (request.signal.aborted) return;
      if (claim && !result.petugas_id) {
        await kirimTugas<Mutasi>(`/${id}/ambil`, { expected_version: result.versi, operasi_id: crypto.randomUUID() }, request.signal);
        if (request.signal.aborted) return;
        result = await tugasRequest<Detail>(`/${id}`, { signal: request.signal });
      }
      if (!request.signal.aborted) setDetail(result);
    } catch (e) {
      if (!request.signal.aborted) setError(e instanceof TugasError ? e : new TugasError('GAGAL_INTERNAL', 500));
    } finally { if (!request.signal.aborted) setLoading(false); }
  };
  const back = () => {
    detailRequest.current?.abort(); currentId.current = null; setDetail(null); setMode('list');
    returnFocus.current = true;
    void load();
  };
  const changed = async (result: Mutasi, completed = false) => {
    setNotice(completed ? 'Keputusan tersimpan.' : 'Perubahan tersimpan.');
    if (completed) { back(); return; }
    await open(result.id, false);
  };
  const restricted = error && [401, 403, 503].includes(error.status);
  return <div className={styles.halaman}>
    <PageHeader title="Tugas UMKM" description="Periksa profil sesuai urutan. Tugas mendesak didahulukan.">
      {mode === 'list' && !loading && !error && <Tombol onClick={() => { listRequest.current?.abort(); setDetail(null); setMode('new'); }}>Tambah profil</Tombol>}
    </PageHeader>
    <p role="status" className="sr-only">{notice}</p>
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
        : <Galat pesan={error.message} onRetry={() => mode === 'detail' && currentId.current
          ? void open(currentId.current, false) : back()} />)}
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
          {list.items.map((task) => <li key={task.id}><div className={styles.baris}>
            <div className={styles.identitas}><strong>{task.nama}</strong><span className={styles.meta}>{task.mendesak ? 'Mendesak. ' : ''}{task.status}. Masuk {formatTanggal(task.dibuat_pada)}</span>{task.petugas_nama && <span className={styles.meta}>sedang dipegang {task.petugas_nama}</span>}{task.tanpa_nomor && <span className={styles.meta}>Belum ada WhatsApp</span>}</div>
            <Tombol varian="sekunder" onClick={() => open(task.id)} aria-label={`Periksa ${task.nama}`}>Periksa</Tombol>
          </div></li>)}
        </ol>}
        <div className={styles.aksi}>{list.next_cursor && <Tombol varian="sekunder" onClick={() => load(list.next_cursor!)}>Halaman berikutnya</Tombol>}{list.items.length > 0 && <Tombol varian="hantu" onClick={() => load()}>Ke awal daftar</Tombol>}</div>
      </Kartu>
    </div>}
    {!restricted && !loading && mode === 'detail' && detail && <DetailTugas key={`${detail.id}:${detail.versi}`} detail={detail} onChanged={changed} onEdit={() => setMode('edit')} onBack={back} onRefresh={() => void open(detail.id, false)} />}
    {!restricted && !loading && (mode === 'new' || mode === 'edit') && <ProfilForm key={mode === 'new' ? 'new' : detail?.id} detail={mode === 'edit' ? detail ?? undefined : undefined} onSaved={(result) => void changed(result)} onCancel={back} />}
    {!restricted && !loading && mode === 'detail' && !detail && error && <Tombol varian="hantu" onClick={back}>Kembali ke daftar</Tombol>}
  </div>;
}
