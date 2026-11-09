'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Field from '@/components/ui/Field';
import Tombol from '@/components/ui/Tombol';
import type { DaftarKatalog, FilterKatalog } from '@/lib/umkm-katalog/types';
import { KatalogError, katalogRequest } from './api';
import KartuKatalog from './KartuKatalog';
import FormulirKatalog, { type KonteksFormulir } from './FormulirKatalog';
import KeadaanKatalog from './KeadaanKatalog';
import styles from './katalog.module.css';

const EMPTY_FILTERS = { jenis: '', kategori: '', spesifik: '', kabupaten_kota: '' };

export default function Katalog() {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [options, setOptions] = useState<FilterKatalog | null>(null);
  const [filterError, setFilterError] = useState(false);
  const [data, setData] = useState<DaftarKatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<KatalogError | null>(null);
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<KonteksFormulir>({});
  const request = useRef<AbortController | null>(null);
  const results = useRef<HTMLHeadingElement>(null);
  const focusResults = useRef(false);

  const load = useCallback(async (cursor?: string) => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(null); setData(null); setNotice('');
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    if (cursor) params.set('cursor', cursor);
    try {
      let response: DaftarKatalog;
      try {
        response = await katalogRequest<DaftarKatalog>(`?${params}`, { signal: controller.signal });
      } catch (e) {
        if (!(e instanceof KatalogError) || e.code !== 'SNAPSHOT_BERUBAH' || !cursor) throw e;
        if (controller.signal.aborted) return;
        setNotice('Urutan katalog diperbarui. Pencarian ditampilkan kembali dari halaman pertama.');
        params.delete('cursor');
        response = await katalogRequest<DaftarKatalog>(`?${params}`, { signal: controller.signal });
      }
      if (!controller.signal.aborted) setData(response);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof KatalogError ? e : new KatalogError('GAGAL_INTERNAL', 500));
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, [search, filters]);

  useEffect(() => {
    const controller = new AbortController();
    void katalogRequest<FilterKatalog>('/filter', { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setOptions(value); })
      .catch(() => { if (!controller.signal.aborted) setFilterError(true); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- muat ulang ketika filter atau kata kunci diterapkan
    void load();
    return () => request.current?.abort();
  }, [load]);
  useEffect(() => {
    if (!loading && focusResults.current) { results.current?.focus(); focusResults.current = false; }
  }, [loading]);

  const contact = (value: KonteksFormulir) => { setContext(value); setOpen(true); };
  const filter = (key: keyof typeof filters, value: string) => {
    request.current?.abort(); setFilters((previous) => ({ ...previous, [key]: value }));
  };

  return <div className={styles.halaman}>
    <Link href="/" className={styles.kembali}>Lampung Maju Hub</Link>
    <header className={styles.kepala}>
      <p className={styles.label}>Usaha daerah Lampung</p>
      <h1>Katalog UMKM</h1>
      <p>Temukan usaha yang sudah diperiksa petugas. Untuk informasi lebih lanjut, hubungi lewat petugas.</p>
    </header>
    <form className={styles.pencarian} onSubmit={(event) => {
      event.preventDefault(); focusResults.current = true;
      if (search === query.trim()) void load(); else setSearch(query.trim());
    }}>
      <Field label="Kata kunci" bantuan="Cari nama usaha atau produk. Gunakan minimal 2 karakter.">
        <input type="search" value={query} maxLength={100} placeholder="Misalnya kopi atau keripik pisang"
          onChange={(event) => setQuery(event.target.value)} />
      </Field>
      <Tombol type="submit">Cari UMKM</Tombol>
    </form>
    <details className={styles.filterWadah}>
      <summary>Filter jenis, kategori, dan wilayah</summary>
      <div className={styles.filter} aria-label="Filter katalog">
      {([
        ['jenis', 'Jenis usaha'], ['kategori', 'Kategori'], ['kabupaten_kota', 'Kabupaten/kota'],
      ] as const).map(([key, label]) => <Field key={key} label={label}>
        <select value={filters[key]} onChange={(event) => filter(key, event.target.value)}>
          <option value="">Semua</option>
          {options?.[key].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </Field>)}
      <Field label="Spesifik (opsional)" bantuan="Isi jenis produk yang lebih khusus, sesuai nama pada profil.">
        <input value={filters.spesifik} maxLength={100} onChange={(event) => filter('spesifik', event.target.value)} />
      </Field>
      </div>
    </details>
    {filterError && <p role="status">Opsi filter belum tersedia. Anda tetap dapat mencari dengan kata kunci.</p>}
    {options?.terpotong && <p>Belum semua pilihan filter ditampilkan. Gunakan kata kunci untuk mempersempit pencarian.</p>}
    <div className={styles.aksi}>
      {(search || Object.values(filters).some(Boolean)) && <Tombol varian="hantu" onClick={() => {
        request.current?.abort(); setQuery(''); setSearch(''); setFilters(EMPTY_FILTERS);
        if (!search && filters === EMPTY_FILTERS) void load();
      }}>Hapus pencarian dan filter</Tombol>}
      <Tombol varian="sekunder" onClick={() => contact(search ? { kata_kunci: search } : {})}>
        Hubungi lewat petugas
      </Tombol>
    </div>
    <section aria-labelledby="hasil-katalog" className={styles.hasil}>
      <h2 id="hasil-katalog" ref={results} tabIndex={-1}>Profil UMKM</h2>
      {notice && <p role="status">{notice}</p>}
      {loading && <p role="status">Memuat katalog UMKM...</p>}
      {error && <KeadaanKatalog error={error} onRetry={() => void load()} />}
      {!loading && data && (data.items.length === 0 ? <div className={styles.keadaan}>
        <h3>Belum ada profil yang cocok</h3>
        <p>Coba kata kunci atau filter lain. Petugas juga dapat membantu menemukan usaha yang Anda cari.</p>
        <Tombol onClick={() => contact(search ? { kata_kunci: search } : {})}>Hubungi lewat petugas</Tombol>
      </div> : <>
        <ul className={styles.kartuDaftar}>
          {data.items.map((item) => <KartuKatalog key={item.id} item={item} onHubungi={contact} />)}
        </ul>
        <div className={styles.aksi}>
          {data.next_cursor && <Tombol onClick={() => {
            focusResults.current = true; void load(data.next_cursor!);
          }}>Halaman berikutnya</Tombol>}
          <Tombol varian="hantu" onClick={() => { focusResults.current = true; void load(); }}>Ke awal daftar</Tombol>
        </div>
      </>)}
    </section>
    <FormulirKatalog key={JSON.stringify(context)} terbuka={open} jenis="pesan" konteks={context}
      onTutup={() => setOpen(false)} />
  </div>;
}
