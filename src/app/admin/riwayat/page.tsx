'use client';

import Tombol from '@/components/ui/Tombol';
import Kartu from '@/components/ui/Kartu';
import Field from '@/components/ui/Field';
import PemilihRentang from '@/components/ui/PemilihRentang';
import Skeleton from '@/components/ui/Skeleton';
import Galat from '@/components/ui/Galat';
import StatusKosong from '@/components/ui/StatusKosong';
import { History } from 'lucide-react';

import tampilan from './page.dasbor.module.css';

import { useCallback, useEffect, useState } from 'react';
import PageHeader from '@/components/layout/PageHeader';
import Pagination from '@/components/Pagination';
import RoleNote from '@/components/admin/RoleNote';
import { adminFetch } from '@/components/admin/adminFetch';
import RiwayatTable, { type RiwayatItem } from '@/components/admin/riwayat/RiwayatTable';

const LIMIT = 50;
const JENIS = [
  'layanan', 'layanan_jadwal', 'layanan_libur', 'site_settings', 'landing_content', 'faq_knowledge_base',
  'layar_token', 'petugas', 'rekap_pelayanan', 'chat_sesi', 'pelayanan_oss', 'pelayanan_perizinan',
];

interface Orang { id: string; nama: string }
interface Filter { jenis: string; orang: string; dari: string; sampai: string }
const KOSONG: Filter = { jenis: '', orang: '', dari: '', sampai: '' };

export default function RiwayatPage() {
  const [orang, setOrang] = useState<Orang[]>([]);
  const [draft, setDraft] = useState<Filter>(KOSONG);
  const [filter, setFilter] = useState<Filter>(KOSONG);
  const [items, setItems] = useState<RiwayatItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    adminFetch<{ akun: Orang[] }>('/api/admin/petugas').then((j) => setOrang(j.akun ?? [])).catch(() => {});
  }, []);

  const load = useCallback(async (f: Filter, p: number) => {
    const qs = new URLSearchParams({ page: String(p + 1), limit: String(LIMIT) });
    (Object.keys(f) as (keyof Filter)[]).forEach((k) => { if (f[k]) qs.set(k, f[k]); });
    try {
      const json = await adminFetch<{ items: RiwayatItem[]; total: number }>(`/api/admin/riwayat?${qs}`);
      setItems(json.items ?? []);
      setTotal(json.total ?? 0);
      setLoadError('');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Gagal memuat riwayat');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(filter, page);
  }, [load, filter, page]);

  const terapkan = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setPage(0);
    setFilter(draft);
  };

  return (
    <>
      <PageHeader title="Riwayat Perubahan" description="Siapa mengubah apa dan kapan" meta="Waktu ditampilkan dalam WIB" />
      <div className={tampilan.area1}>
        <RoleNote>Hanya Admin yang dapat melihat halaman ini. Nilai rahasia (token, kunci) tidak pernah ditampilkan.</RoleNote>
        <Kartu judul="Filter riwayat">
          <form onSubmit={terapkan} aria-label="Filter riwayat" className={tampilan.filter}>
            <Field label="Jenis">
              <select id="rwJenis" value={draft.jenis} onChange={(e) => setDraft({ ...draft, jenis: e.target.value })}>
                <option value="">Semua</option>
                {JENIS.map((j) => <option key={j} value={j}>{j}</option>)}
              </select>
            </Field>
            <Field label="Pelaku">
              <select id="rwOrang" value={draft.orang} onChange={(e) => setDraft({ ...draft, orang: e.target.value })}>
                <option value="">Semua</option>
                {orang.map((o) => <option key={o.id} value={o.id}>{o.nama}</option>)}
              </select>
            </Field>
            <PemilihRentang label="Rentang tanggal" dari={draft.dari} sampai={draft.sampai}
              onUbah={({ dari, sampai }) => setDraft({ ...draft, dari, sampai })} />
            <Tombol type="submit">Terapkan</Tombol>
          </form>
        </Kartu>
        <Kartu judul="Riwayat perubahan" padding="tanpa">
          {loading ? <Skeleton bentuk="baris" jumlah={5} label="Memuat riwayat" /> : loadError ? (
            <Galat pesan={loadError} onRetry={() => { setLoading(true); void load(filter, page); }} />
          ) : items.length === 0 ? (
            <StatusKosong ikon={History} judul="Tidak ada riwayat untuk filter ini." />
          ) : (
            <>
              <RiwayatTable items={items} />
              <Pagination page={page} pageSize={LIMIT} total={total} onPageChange={setPage} />
            </>
          )}
        </Kartu>
      </div>
    </>
  );
}
