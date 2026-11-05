'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Search } from 'lucide-react';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import Galat from '@/components/ui/Galat';
import Kartu from '@/components/ui/Kartu';
import PemilihRentang from '@/components/ui/PemilihRentang';
import StatusKosong from '@/components/ui/StatusKosong';
import Tabel, { type KolomTabel } from '@/components/ui/Tabel';
import Tombol from '@/components/ui/Tombol';
import PageHeader from '@/components/layout/PageHeader';
import Pagination from '@/components/Pagination';
import { useToast } from '@/components/Toast';
import RoleNote from '@/components/admin/RoleNote';
import { adminFetch } from '@/components/admin/adminFetch';
import TamuForm, { type TamuInput } from '@/components/admin/bukutamu/TamuForm';
import { formatHpTampil, normalisasiHp } from '@/lib/fo/walkin';
import { todayWIB } from '@/lib/time';
import { formatTanggal, formatWaktu } from '@/lib/utils';
import styles from './buku-tamu.module.css';

interface Tamu {
  id: string;
  nama: string;
  instansi: string | null;
  no_hp: string | null;
  bertemu: string | null;
  tujuan: string | null;
  waktu_masuk: string;
  dicatat_oleh: string | null;
  dicatat_nama: string | null;
}

const LIMIT = 50;
const TANGGAL_SINGKAT: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
// Disimpan sebagai +62...; ditampilkan seperti di Front Office (0812-3456-7890).
const hpTampil = (hp: string | null) => (hp ? formatHpTampil(normalisasiHp(hp)) : '—');

export default function BukuTamuPage() {
  const { toast } = useToast();
  const [items, setItems] = useState<Tamu[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [dari, setDari] = useState(todayWIB);
  const [sampai, setSampai] = useState(todayWIB);
  const [cari, setCari] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const permintaan = useRef(0);

  const rentangSalah = dari > sampai;

  const load = useCallback(async (p: number, d: string, s: string, kata: string) => {
    const no = ++permintaan.current;
    setLoading(true);
    try {
      const sp = new URLSearchParams({ page: String(p + 1), limit: String(LIMIT), dari: d, sampai: s });
      if (kata) sp.set('q', kata);
      const json = await adminFetch<{ items: Tamu[]; total: number }>(`/api/admin/buku-tamu?${sp}`);
      if (no !== permintaan.current) return; // jawaban basi dibuang
      setItems(json.items ?? []);
      setTotal(json.total ?? 0);
      setLoadError('');
    } catch (e) {
      if (no !== permintaan.current) return;
      setLoadError(e instanceof Error ? e.message : 'Gagal memuat buku tamu');
    } finally {
      if (no === permintaan.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (rentangSalah) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(page, dari, sampai, q);
  }, [load, page, dari, sampai, q, rentangSalah]);

  // Pencarian ditunda sebentar supaya tidak memuat ulang di tiap ketukan.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ((lama) => {
        const baru = cari.trim();
        if (baru !== lama) setPage(0);
        return baru;
      });
    }, 300);
    return () => clearTimeout(t);
  }, [cari]);

  const hariIni = () => {
    const h = todayWIB();
    setDari(h);
    setSampai(h);
    setCari('');
    setQ('');
    setPage(0);
  };

  const catat = async (data: TamuInput) => {
    await adminFetch('/api/admin/buku-tamu', 'POST', data);
    toast('Tamu dicatat.', 'success');
    // Tamu baru bertanggal hari ini: pastikan terlihat di daftar.
    const h = todayWIB();
    if (dari > h || sampai < h || q) { hariIni(); return; }
    if (page === 0) await load(0, dari, sampai, q); else setPage(0);
  };

  const hariIniSaja = dari === todayWIB() && sampai === todayWIB();
  const periode = dari === sampai ? formatTanggal(dari) : `${formatTanggal(dari)} sampai ${formatTanggal(sampai)}`;

  const kolom: KolomTabel<Tamu>[] = [
    { kunci: 'waktu', judul: 'Waktu', render: (t) => <span className={styles.waktu}>{formatTanggal(t.waktu_masuk, TANGGAL_SINGKAT)}<span className={styles.sub}>{formatWaktu(t.waktu_masuk)} WIB</span></span> },
    { kunci: 'nama', judul: 'Nama', judulBaris: true, render: (t) => t.nama },
    { kunci: 'instansi', judul: 'Instansi', render: (t) => t.instansi ?? '—' },
    { kunci: 'hp', judul: 'Nomor HP', render: (t) => <span className={styles.waktu}>{hpTampil(t.no_hp)}</span> },
    { kunci: 'bertemu', judul: 'Bertemu', render: (t) => t.bertemu ?? '—' },
    { kunci: 'tujuan', judul: 'Tujuan', render: (t) => <span className={styles.tujuan} title={t.tujuan ?? undefined}>{t.tujuan ?? '—'}</span> },
    { kunci: 'pencatat', judul: 'Dicatat oleh', render: (t) => t.dicatat_nama ?? '—' },
  ];

  return (
    <>
      <PageHeader title="Buku Tamu" description="Catatan tamu kantor" />
      <div className={styles.isi}>
        <RoleNote>Admin dan Front Office dapat mencatat tamu kantor. Daftar menampilkan semua tamu pada tanggal yang dipilih (bawaan: hari ini); kolom &ldquo;Dicatat oleh&rdquo; menandai siapa yang mencatat.</RoleNote>
        <Kartu as="div"><TamuForm onSubmit={catat} /></Kartu>
        <Kartu judul="Daftar tamu" className={styles.daftar}>
          <div className={styles.filter} role="search" aria-label="Filter buku tamu">
            <PemilihRentang dari={dari} sampai={sampai} max={todayWIB()} label="Rentang tanggal buku tamu"
              onUbah={(r) => { setDari(r.dari); setSampai(r.sampai); setPage(0); }} />
            <div className={`form-group ${styles.cari}`}>
              <label className="form-label" htmlFor="btCari">Cari tamu</label>
              <input id="btCari" type="search" className="form-input" value={cari} maxLength={100}
                placeholder="Nama, instansi, atau yang ditemui" onChange={(e) => setCari(e.target.value)} />
            </div>
            <Tombol varian="sekunder" onClick={hariIni} disabled={hariIniSaja && !cari && !q}>Hari ini</Tombol>
          </div>
          {rentangSalah && <p className="form-error" role="alert">Tanggal akhir tidak boleh sebelum tanggal awal.</p>}
          {!rentangSalah && !loading && !loadError && (
            <p className={styles.ringkas} role="status">{total} tamu pada {periode}{q ? ` dengan kata kunci "${q}"` : ''}</p>
          )}
          {rentangSalah ? (
            <CatatanKeadaan jenis="info">Ubah tanggal untuk menampilkan daftar tamu.</CatatanKeadaan>
          ) : loadError && !loading ? (
            <Galat pesan={loadError} onRetry={() => { void load(page, dari, sampai, q); }} />
          ) : (
            <Tabel kolom={kolom} baris={items} kunciBaris={(t) => t.id} caption="Daftar tamu kantor" memuat={loading}
              kosong={<StatusKosong ikon={q ? Search : BookOpen} judul={hariIniSaja && !q ? 'Belum ada tamu tercatat hari ini.' : 'Tidak ada tamu yang cocok dengan tanggal dan pencarian ini.'} />} />
          )}
          {!rentangSalah && !loading && !loadError && items.length > 0 && (
            <Pagination page={page} pageSize={LIMIT} total={total} onPageChange={setPage} />
          )}
        </Kartu>
      </div>
    </>
  );
}
