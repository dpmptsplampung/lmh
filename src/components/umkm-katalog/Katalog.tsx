'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Search, SearchX, SlidersHorizontal, Store, X } from 'lucide-react';
import Field from '@/components/ui/Field';
import Tombol from '@/components/ui/Tombol';
import type { DaftarKatalog, FilterKatalog } from '@/lib/umkm-katalog/types';
import { KatalogError, katalogRequest } from './api';
import KartuKatalog from './KartuKatalog';
import FormulirKatalog, { type KonteksFormulir } from './FormulirKatalog';
import KeadaanKatalog from './KeadaanKatalog';
import { URUTAN_JENIS, gantiJenis, kategoriUntuk, labelJenis } from '@/lib/umkm-katalog/filter-bertingkat';
import styles from './publik.module.css';

const EMPTY_FILTERS = { jenis: '', kategori: '', spesifik: '', kabupaten_kota: '' };
const LABEL_FILTER = { jenis: 'Jenis usaha', kategori: 'Kategori', kabupaten_kota: 'Kabupaten/kota', spesifik: 'Spesifik' };

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
  const [panelOpen, setPanelOpen] = useState(false);
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
  const pilihJenis = (jenis: string) => {
    request.current?.abort(); setFilters((previous) => gantiJenis(previous, jenis));
  };
  const resetAll = () => {
    request.current?.abort(); setQuery(''); setSearch(''); setFilters(EMPTY_FILTERS);
    if (!search && filters === EMPTY_FILTERS) void load();
  };
  const activeFilters = (Object.keys(EMPTY_FILTERS) as (keyof typeof filters)[]).filter((key) => filters[key]);
  const searching = Boolean(search) || activeFilters.length > 0;
  // Katalog belum punya pilihan sama sekali (belum ada profil terbit): panel filter tidak berguna.
  const noOptions = options !== null && !options.jenis.length && !options.kategori.length
    && !options.kabupaten_kota.length;
  const showFilter = !(noOptions && activeFilters.length === 0);
  const jenisChip = options ? URUTAN_JENIS.filter((value) => options.jenis.includes(value)) : [];
  const kategoriChip = options ? kategoriUntuk(filters.jenis, options.kategori) : [];
  const empty = !loading && data !== null && data.items.length === 0;

  return <div className={styles.halaman}>
    <section className={styles.sampul} aria-labelledby="judul-katalog">
      <div className={styles.sampulIsi}>
        <h1 id="judul-katalog" className={styles.judulBesar}>Katalog UMKM Lampung</h1>
        <p className={styles.sampulTeks}>Profil usaha yang sudah diperiksa petugas. Nomor pemilik usaha tidak
          tampil untuk umum; hubungi pemilik lewat petugas.</p>
        <form role="search" aria-label="Cari UMKM" className={styles.pencarian} onSubmit={(event) => {
          event.preventDefault(); focusResults.current = true;
          if (search === query.trim()) void load(); else setSearch(query.trim());
        }}>
          <Field label="Kata kunci" bantuan="Cari nama usaha atau produk. Gunakan minimal 2 karakter.">
            {(props) => <div className={styles.kotakCari}>
              <Search size={20} aria-hidden="true" className={styles.ikonCari} />
              <input {...props} type="search" value={query} maxLength={100}
                placeholder="Misalnya kopi atau keripik" onChange={(event) => setQuery(event.target.value)} />
              <Tombol type="submit" className={styles.tombolCari}>Cari UMKM</Tombol>
            </div>}
          </Field>
        </form>
        {jenisChip.length > 0 && <div className={styles.chipKategori} role="group" aria-label="Pilih jenis usaha">
          <button type="button" className={styles.chip} aria-pressed={!filters.jenis}
            onClick={() => pilihJenis('')}>Semua jenis</button>
          {jenisChip.map((value) => <button key={value} type="button" className={styles.chip}
            aria-pressed={filters.jenis === value} onClick={() => pilihJenis(value)}>{labelJenis(value)}</button>)}
        </div>}
        {options && filters.jenis && (kategoriChip.length > 0
          ? <div className={styles.chipKategori} role="group" aria-label="Pilih kategori">
            <button type="button" className={styles.chip} aria-pressed={!filters.kategori}
              onClick={() => filter('kategori', '')}>Semua kategori</button>
            {kategoriChip.map((value) => <button key={value} type="button" className={styles.chip}
              aria-pressed={filters.kategori === value} onClick={() => filter('kategori', value)}>{value}</button>)}
          </div>
          : <p className={styles.sampulTeks}>Belum ada kategori untuk jenis ini.</p>)}
      </div>
    </section>

    <div className={`${styles.isi} ${showFilter ? '' : styles.isiTanpaFilter}`}>
      {showFilter && <aside className={styles.saring} aria-label="Saring hasil">
        <button type="button" data-filter-toggle className={styles.tombolFilter} aria-expanded={panelOpen}
          aria-controls="panel-filter" onClick={() => setPanelOpen((value) => !value)}>
          <SlidersHorizontal size={18} aria-hidden="true" />
          Filter{activeFilters.length > 0 && <>{' '}<span className={styles.hitung}>{activeFilters.length}
            <span className="sr-only">{' '}aktif</span></span></>}
        </button>
        <div id="panel-filter" className={`${styles.panelFilter} ${panelOpen ? styles.panelTerbuka : ''}`}>
          <h2 className={styles.judulSaring}>Saring hasil</h2>
          <div className={styles.filter} role="group" aria-label="Filter katalog">
            <Field label="Kabupaten/kota">
              <select value={filters.kabupaten_kota} onChange={(event) => filter('kabupaten_kota', event.target.value)}>
                <option value="">Semua</option>
                {options?.kabupaten_kota.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </Field>
            <Field label="Spesifik (opsional)" bantuan="Isi jenis produk yang lebih khusus, sesuai nama pada profil.">
              <input value={filters.spesifik} maxLength={100} onChange={(event) => filter('spesifik', event.target.value)} />
            </Field>
          </div>
          {filterError && <p role="status" className={styles.catatan}>Opsi filter belum tersedia. Anda tetap dapat
            mencari dengan kata kunci.</p>}
          {options?.terpotong && <p className={styles.catatan}>Belum semua pilihan filter ditampilkan. Gunakan kata
            kunci untuk mempersempit pencarian.</p>}
          <Tombol varian="sekunder" className={styles.tutupFilter} onClick={() => {
            setPanelOpen(false); results.current?.focus();
          }}>Lihat hasil</Tombol>
        </div>
      </aside>}

      <section aria-labelledby="hasil-katalog" className={styles.hasil}>
        <div className={styles.hasilKepala}>
          <h2 id="hasil-katalog" ref={results} tabIndex={-1}>Profil UMKM</h2>
          {searching && <div className={styles.aktif} role="group" aria-label="Pencarian dan filter aktif">
            {search && <button type="button" className={styles.chipAktif}
              aria-label={`Hapus kata kunci ${search}`} onClick={() => {
                request.current?.abort(); setQuery(''); setSearch('');
              }}>{search}<X size={14} aria-hidden="true" /></button>}
            {activeFilters.map((key) => <button key={key} type="button" className={styles.chipAktif}
              aria-label={`Hapus filter ${LABEL_FILTER[key]} ${filters[key]}`} onClick={() => filter(key, '')}>
              {key === 'jenis' ? labelJenis(filters[key]) : filters[key]}<X size={14} aria-hidden="true" />
            </button>)}
            <Tombol varian="hantu" ukuran="kecil" onClick={resetAll}>Hapus pencarian dan filter</Tombol>
          </div>}
        </div>
        {notice && <p role="status" className={styles.catatan}>{notice}</p>}
        {loading && <>
          <p role="status" className={styles.memuat}>Memuat katalog UMKM...</p>
          <ul className={styles.kartuDaftar} aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => <li key={index} className={styles.kartuKerangka}>
              <span className={styles.kerangkaFoto} /><span className={styles.kerangkaBaris} />
              <span className={styles.kerangkaBaris} /></li>)}
          </ul>
        </>}
        {error && <KeadaanKatalog error={error} onRetry={() => void load()} />}
        {empty && (searching ? <div className={styles.panel}>
          <SearchX size={32} aria-hidden="true" className={styles.panelIkon} />
          <h3>Belum ada profil yang cocok</h3>
          <p>{search ? <>Tidak ada profil untuk &ldquo;{search}&rdquo;{activeFilters.length ? ' dengan filter ini' : ''}. </>
            : 'Tidak ada profil dengan filter ini. '}
            Coba kata kunci atau filter lain. Petugas juga dapat membantu menemukan usaha yang Anda cari.</p>
          <div className={styles.panelAksi}>
            <Tombol onClick={() => contact(search ? { kata_kunci: search } : {})}>Hubungi lewat petugas</Tombol>
          </div>
        </div> : <div className={`${styles.panel} ${styles.panelSiap}`}>
          <Store size={36} aria-hidden="true" className={styles.panelIkon} />
          <h3>Profil UMKM sedang disiapkan</h3>
          <p>Petugas sedang memeriksa profil usaha sebelum tampil di katalog. Sementara itu, petugas tetap dapat
            membantu mencarikan usaha yang Anda butuhkan.</p>
          <div className={styles.panelAksi}>
            <Tombol onClick={() => contact({})}>Hubungi lewat petugas</Tombol>
          </div>
          <div className={styles.pemilik}>
            <h4>Punya usaha di Lampung?</h4>
            <p>Daftarkan usaha Anda. Profil tampil di katalog setelah diperiksa petugas.</p>
            <Tombol varian="sekunder" href="/me/usaha">Daftarkan usaha</Tombol>
          </div>
        </div>)}
        {!loading && data && data.items.length > 0 && <>
          <ul className={styles.kartuDaftar}>
            {data.items.map((item) => <KartuKatalog key={item.id} item={item} onHubungi={contact} />)}
          </ul>
          <nav className={styles.halamanNav} aria-label="Halaman daftar">
            <Tombol varian="hantu" onClick={() => { focusResults.current = true; void load(); }}>Ke awal daftar</Tombol>
            {data.next_cursor && <Tombol className={styles.berikutnya} onClick={() => {
              focusResults.current = true; void load(data.next_cursor!);
            }}>Halaman berikutnya<ArrowRight size={18} aria-hidden="true" /></Tombol>}
          </nav>
        </>}
      </section>

      {!empty && <aside className={styles.bantuan} aria-labelledby="judul-bantuan">
        <h2 id="judul-bantuan">Belum menemukan usaha yang Anda cari?</h2>
        <p>Petugas DPMPTSP dapat membantu mencarikan usaha yang sesuai kebutuhan Anda.</p>
        <Tombol varian="sekunder" onClick={() => contact(search ? { kata_kunci: search } : {})}>
          Hubungi lewat petugas
        </Tombol>
        <p className={styles.bantuanPemilik}>Punya usaha di Lampung? <Link href="/me/usaha">Daftarkan usaha</Link></p>
      </aside>}
    </div>
    <FormulirKatalog key={JSON.stringify(context)} terbuka={open} jenis="pesan" konteks={context}
      onTutup={() => setOpen(false)} />
  </div>;
}
