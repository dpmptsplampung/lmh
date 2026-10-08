'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
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
      <PageHeader title="Riwayat Perubahan" description="Siapa mengubah apa dan kapan" />
      <div style={{ padding: 'clamp(var(--space-4), 4vw, var(--space-8))' }}>
        <RoleNote>Hanya Admin yang dapat melihat halaman ini. Nilai rahasia (token, kunci) tidak pernah ditampilkan.</RoleNote>
        <form onSubmit={terapkan} aria-label="Filter riwayat"
          style={{ display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 'var(--space-4)' }}>
          <div className="form-group">
            <label className="form-label" htmlFor="rwJenis">Jenis</label>
            <select id="rwJenis" className="form-input" value={draft.jenis} onChange={(e) => setDraft({ ...draft, jenis: e.target.value })}>
              <option value="">Semua</option>
              {JENIS.map((j) => <option key={j} value={j}>{j}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="rwOrang">Pelaku</label>
            <select id="rwOrang" className="form-input" value={draft.orang} onChange={(e) => setDraft({ ...draft, orang: e.target.value })}>
              <option value="">Semua</option>
              {orang.map((o) => <option key={o.id} value={o.id}>{o.nama}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="rwDari">Dari tanggal</label>
            <input id="rwDari" type="date" className="form-input" value={draft.dari} onChange={(e) => setDraft({ ...draft, dari: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="rwSampai">Sampai tanggal</label>
            <input id="rwSampai" type="date" className="form-input" value={draft.sampai} onChange={(e) => setDraft({ ...draft, sampai: e.target.value })} />
          </div>
          <div style={{ alignSelf: 'end' }}>
            <button type="submit" className="btn btn--primary">Terapkan</button>
          </div>
        </form>
        <div className="table-wrapper">
          {loading ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center' }} role="status" aria-label="Memuat">
              <Loader2 size={24} className="animate-pulse" style={{ margin: '0 auto' }} />
            </div>
          ) : loadError ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center' }} role="alert" className="form-error">{loadError}</div>
          ) : items.length === 0 ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-tertiary)' }}>Tidak ada riwayat untuk filter ini.</div>
          ) : (
            <>
              <RiwayatTable items={items} />
              <Pagination page={page} pageSize={LIMIT} total={total} onPageChange={setPage} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
