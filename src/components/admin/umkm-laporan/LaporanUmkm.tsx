'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import PageHeader from '@/components/layout/PageHeader';
import Kartu from '@/components/ui/Kartu';
import Tombol from '@/components/ui/Tombol';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import { createClient } from '@/lib/supabase/client';
import type { LaporanStatistik } from '@/lib/umkm-katalog/types';
import { menitWIB, toWIBDateString } from '@/lib/time';
import { LaporanError, laporanRequest, laporanResponse } from './api';
import { LABEL_HASIL, LABEL_STATUS, lamaTunggu } from './permintaan';
import SakelarStatistik from './SakelarStatistik';
import styles from './laporan.module.css';

const number = new Intl.NumberFormat('id-ID');
const angka = (value: number | null) => value === null ? 'belum dicatat' : number.format(value);
const statusLabels = {
  diajukan: 'Diajukan', terbit: 'Terbit', disembunyikan: 'Disembunyikan', ditolak: 'Ditolak',
};

export default function LaporanUmkm() {
  const [data, setData] = useState<LaporanStatistik | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LaporanError | null>(null);
  const [admin, setAdmin] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const request = useRef<AbortController | null>(null);
  const heading = useRef<HTMLSpanElement>(null);
  const withRequests = Boolean(data?.permintaan);
  const activeSince = data?.aktif_pada ? new Date(data.aktif_pada) : null;
  const activeMinute = activeSince ? menitWIB(activeSince) : 0;
  const load = useCallback(async (cursor?: string) => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(null);
    try {
      const params = cursor ? `?${new URLSearchParams({ cursor })}` : '';
      const value = await laporanRequest<LaporanStatistik>(params, { signal: controller.signal });
      if (!controller.signal.aborted) { setData(value); if (cursor) heading.current?.focus(); }
    } catch (e) {
      if (!controller.signal.aborted) {
        setData(null); setError(e instanceof LaporanError ? e : new LaporanError('GAGAL_INTERNAL', 500));
      }
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        const client = createClient();
        const { data: auth } = await client.auth.getUser();
        if (!auth.user) return;
        const { data: staff } = await client.from('petugas').select('role, aktif')
          .eq('auth_user_id', auth.user.id).maybeSingle();
        if (mounted) setAdmin(staff?.role === 'admin' && staff.aktif === true);
      } catch { /* Sakelar hanya tampil setelah hak admin diketahui. */ }
    };
    void check();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data awal laporan dimuat melalui API
    void load();
    return () => { mounted = false; request.current?.abort(); };
  }, [load]);

  const download = async () => {
    if (exporting) return;
    setExporting(true); setExportError('');
    try {
      const response = await laporanResponse('/export');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url; link.download = 'laporan-umkm.csv';
      document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e instanceof LaporanError ? e.message : 'Unduhan belum berhasil. Silakan coba lagi.');
    } finally { setExporting(false); }
  };

  return <div className={styles.halaman}>
    <PageHeader title="Laporan UMKM" description="Ringkasan profil dan penggunaan katalog UMKM.">
      <Tombol varian="sekunder" disabled={loading} onClick={() => void load()}>Muat ulang</Tombol>
      {data && <Tombol varian="sekunder" memuat={exporting} onClick={() => void download()}>Unduh CSV</Tombol>}
    </PageHeader>
    {loading && <p role="status">Memuat laporan UMKM...</p>}
    {exportError && <p role="status">{exportError}</p>}
    {error && <CatatanKeadaan jenis={error.status === 503 ? 'menunggu-migrasi'
      : [401, 403].includes(error.status) ? 'lingkup' : 'galat'}
      judul={error.status === 503 ? 'Laporan UMKM belum tersedia' : 'Laporan belum dapat ditampilkan'}
      aksi={<Tombol varian="sekunder" onClick={() => void load()}>Coba lagi</Tombol>}>
      {error.message}
    </CatatanKeadaan>}
    {data && <>
      <Kartu judul="Ringkasan">
        {activeSince && <p>Waktu aktif sakelar: <time dateTime={data.aktif_pada!}>
          {toWIBDateString(activeSince)} {String(Math.floor(activeMinute / 60)).padStart(2, '0')}:
          {String(activeMinute % 60).padStart(2, '0')} WIB
        </time></p>}
        <dl className={styles.angka}>
          {Object.entries(statusLabels).map(([key, label]) => <div key={key}>
            <dt>Profil {label.toLowerCase()}</dt><dd>{angka(data.profil[key as keyof typeof statusLabels])}</dd>
          </div>)}
          <div><dt>Suka total</dt><dd>{angka(data.suka)}</dd></div>
          <div><dt>Dilihat total</dt><dd>{angka(data.telemetri_opsional_aktif ? data.dilihat : null)}</dd></div>
          <div><dt>Pencarian tanpa hasil</dt><dd>{angka(data.telemetri_opsional_aktif ? data.tanpa_hasil : null)}</dd></div>
        </dl>
      </Kartu>
      <Kartu judul="Pesan dan laporan dalam masa simpan 180 hari">
        <dl className={styles.angka}>
          <div><dt>Pesan baru</dt><dd>{angka(data.pesan.baru)}</dd></div>
          <div><dt>Pesan ditangani</dt><dd>{angka(data.pesan.ditangani)}</dd></div>
          <div><dt>Laporan baru</dt><dd>{angka(data.laporan.baru)}</dd></div>
          <div><dt>Laporan ditangani</dt><dd>{angka(data.laporan.ditangani)}</dd></div>
        </dl>
        <p>Data disimpan hingga 180 hari sejak ditangani, atau aktivitas terakhir bila belum ditangani.</p>
      </Kartu>
      {data.permintaan && <Kartu judul="Permintaan kontak">
        <dl className={styles.angka}>
          {Object.entries(LABEL_STATUS).map(([key, label]) => <div key={key}>
            <dt>{label}</dt><dd>{angka(data.permintaan![key as keyof typeof LABEL_STATUS] ?? 0)}</dd>
          </div>)}
        </dl>
        <dl className={styles.angka}>
          <div><dt>Rata-rata lama tunggu sampai keputusan</dt><dd>{lamaTunggu(data.rata_keputusan_detik ?? null)}</dd></div>
          {Object.entries(LABEL_HASIL).map(([key, label]) => <div key={key}>
            <dt>Hasil: {label}</dt><dd>{angka(data.hasil?.[key as keyof typeof LABEL_HASIL] ?? 0)}</dd>
          </div>)}
        </dl>
        <p>Nomor yang sudah dibuka tidak dihitung sebagai kerja sama sebelum hasilnya dicatat.</p>
      </Kartu>}
      <Kartu judul={<span ref={heading} tabIndex={-1}>Statistik per UMKM</span>}>
        {data.profil_statistik.length === 0 ? <p>Belum ada profil untuk ditampilkan.</p> : <table>
          <caption className="sr-only">Suka, dilihat, dan klik formulir per UMKM</caption>
          <thead><tr><th scope="col">UMKM</th><th scope="col">Suka</th><th scope="col">Dilihat</th>
            <th scope="col">Klik formulir</th>
            {withRequests && <th scope="col">Permintaan kontak</th>}</tr></thead>
          <tbody>{data.profil_statistik.map((profile) => <tr key={profile.id}>
            <th scope="row">{profile.nama}</th><td data-label="Suka">{angka(profile.suka)}</td>
            <td data-label="Dilihat">{angka(data.telemetri_opsional_aktif ? profile.dilihat : null)}</td>
            <td data-label="Klik formulir">{angka(data.telemetri_opsional_aktif ? profile.klik_formulir : null)}</td>
            {withRequests && <td data-label="Permintaan kontak">{angka(
              (profile as typeof profile & { permintaan?: number }).permintaan ?? 0)}</td>}
          </tr>)}</tbody>
        </table>}
        <div className={styles.aksi}>
          {data.next_cursor && <Tombol varian="sekunder" disabled={loading}
            onClick={() => void load(data.next_cursor!)}>Halaman berikutnya</Tombol>}
          <Tombol varian="hantu" disabled={loading} onClick={() => void load()}>Ke awal daftar</Tombol>
        </div>
      </Kartu>
      <Kartu judul="Kelompok pencarian tanpa hasil">
        {!data.telemetri_opsional_aktif ? <p>belum dicatat</p>
          : data.kelompok_tanpa_hasil.length === 0 ? <p>Belum ada pencarian tanpa hasil.</p> : <>
            <p>Menampilkan paling banyak 20 kelompok terbaru.</p>
            <table>
              <caption className="sr-only">Pencarian tanpa hasil menurut hari, kategori, dan wilayah</caption>
              <thead><tr><th scope="col">Hari (WIB)</th><th scope="col">Kategori</th>
                <th scope="col">Kabupaten/kota</th><th scope="col">Jumlah</th></tr></thead>
              <tbody>{data.kelompok_tanpa_hasil.map((group) => <tr
                key={JSON.stringify([group.hari, group.kategori, group.kabupaten_kota])}>
                <th scope="row">{group.hari}</th><td data-label="Kategori">{group.kategori || 'Semua kategori'}</td>
                <td data-label="Kabupaten/kota">{group.kabupaten_kota || 'Semua wilayah'}</td>
                <td data-label="Jumlah">{angka(group.jumlah)}</td>
              </tr>)}</tbody>
            </table>
          </>}
      </Kartu>
      {admin && <Kartu judul="Pengaturan pencatatan opsional">
        <SakelarStatistik status={data} onSimpan={() => void load()} />
      </Kartu>}
    </>}
  </div>;
}
