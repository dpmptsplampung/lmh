'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Download, RefreshCw, AlertCircle, Loader2, Eye } from 'lucide-react';
import Pagination from '@/components/Pagination';
import { useToast } from '@/components/Toast';
import RekapTiketDetailPanel from '@/components/admin/RekapTiketDetailPanel';
import { formatTanggalId, formatWaktuId, hitungDurasiMenit, todayWIB } from '@/lib/rekap/format';
import type { RekapTicketRow } from '@/lib/rekap/excel';

export interface LayananOption {
  id: string;
  nama: string;
}

const PAGE_SIZE = 25;

interface Props {
  isPetugas: boolean;
  initialLayananId: string | null;
  options: LayananOption[];
}

export default function RekapLayananTable({ isPetugas, initialLayananId, options }: Props) {
  const { toast } = useToast();
  const [layananId, setLayananId] = useState<string>(initialLayananId ?? '');
  const [dari, setDari] = useState<string>(() => {
    const d = new Date(todayWIB());
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [sampai, setSampai] = useState<string>(() => todayWIB());
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<RekapTicketRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RekapTicketRow | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (layananId) params.set('layanan_id', layananId);
      if (q.trim()) params.set('q', q.trim());
      params.set('dari', dari);
      params.set('sampai', sampai);
      params.set('page', String(page));
      params.set('page_size', String(PAGE_SIZE));
      const res = await fetch(`/api/admin/rekap/tickets?${params}`);
      const body = await res.json();
      if (!res.ok) {
        if (res.status === 403) {
          toast('Anda tidak punya akses ke layanan ini', 'error');
        } else {
          toast(body.error ?? 'Gagal memuat rekap', 'error');
        }
        setError(body.error ?? 'Gagal memuat rekap');
        setRows([]);
        setTotal(0);
        return;
      }
      setRows(body.rows ?? []);
      setTotal(body.total ?? 0);
    } catch {
      setError('Tidak ada koneksi');
      toast('Tidak ada koneksi', 'error');
    } finally {
      setLoading(false);
    }
  }, [layananId, q, dari, sampai, page, toast]);

  // Initial fetch + on filter change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchRows();
    }, q ? 300 : 0); // debounce only on search
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchRows, q]);

  const durasiPerBaris = rows.map((r) =>
    hitungDurasiMenit(r.waktu_mulai_layan, r.waktu_selesai),
  );
  const durasiValid = durasiPerBaris.filter((d): d is number => d != null);
  const rataDurasi =
    durasiValid.length > 0
      ? Math.round(durasiValid.reduce((s, d) => s + d, 0) / durasiValid.length)
      : 0;

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (layananId) params.set('layanan_id', layananId);
      if (q.trim()) params.set('q', q.trim());
      params.set('dari', dari);
      params.set('sampai', sampai);
      const res = await fetch(`/api/admin/rekap/export?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast(body.error ?? 'Gagal mengekspor Excel', 'error');
        return;
      }
      const blob = await res.blob();
      const filename =
        res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ?? 'rekap.xlsx';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      if (res.headers.get('X-Rekap-Truncated') === 'true') {
        toast('Data terpotong ke 50.000 baris. Persempit rentang tanggal.', 'warning');
      } else {
        toast('Berkas Excel berhasil diunduh', 'success');
      }
    } catch {
      toast('Gagal mengekspor Excel', 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      {/* Filter bar */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'flex-end',
        padding: 'var(--space-4)', background: '#ffffff', borderRadius: 'var(--radius-lg, 12px)',
        border: '1px solid var(--border-default, #e2e8f0)', marginBottom: 'var(--space-4)',
      }}>
        <div className="form-group" style={{ marginBottom: 0, minWidth: 200 }}>
          <label className="form-label">Layanan</label>
          <select
            className="form-input"
            value={layananId}
            onChange={(e) => { setLayananId(e.target.value); setPage(0); }}
            disabled={isPetugas}
          >
            {!isPetugas && <option value="">Semua Layanan</option>}
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.nama}</option>
            ))}
            {isPetugas && initialLayananId && (
              <option value={initialLayananId}>{options.find(o => o.id === initialLayananId)?.nama ?? initialLayananId}</option>
            )}
          </select>
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Dari</label>
          <input type="date" className="form-input" value={dari} onChange={(e) => { setDari(e.target.value); setPage(0); }} />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Sampai</label>
          <input type="date" className="form-input" value={sampai} onChange={(e) => { setSampai(e.target.value); setPage(0); }} />
        </div>
        <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}>
          <label className="form-label">Cari</label>
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
            <input
              type="text"
              className="form-input"
              placeholder="Nama, nomor, usaha..."
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(0); }}
              style={{ paddingLeft: 36 }}
            />
          </div>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={() => { setPage(0); fetchRows(); }} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
        <button className="btn btn--primary btn--sm" onClick={handleExport} disabled={loading || exporting || rows.length === 0}>
          {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {' '}Download Excel
        </button>
      </div>

      {/* Stats */}
      <div className="grid-stats" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="stat-card">
          <span className="stat-card__value">{total}</span>
          <span className="stat-card__label">Total Selesai (rentang)</span>
        </div>
        <div className="stat-card">
          <span className="stat-card__value">{rataDurasi}</span>
          <span className="stat-card__label">Rata-rata Durasi (mnt, halaman ini)</span>
        </div>
      </div>

      {/* Table */}
      <div className="table-wrapper">
        {loading ? (
          <table className="table" aria-hidden="true">
            <tbody>
              {Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={10}><div className="skeleton" style={{ height: 20, width: '100%' }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-danger-700)' }}>
            <AlertCircle size={32} style={{ margin: '0 auto var(--space-3)' }} />
            <p>{error}</p>
            <button className="btn btn--primary btn--sm" onClick={fetchRows} style={{ marginTop: 'var(--space-3)' }}>
              Coba Lagi
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--text-tertiary)' }}>
            <p>Tidak ada tiket selesai dalam rentang tanggal ini.</p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>No Antrian</th>
                <th>Nama Pengunjung</th>
                <th>Asal</th>
                <th>Petugas</th>
                <th>Mulai</th>
                <th>Selesai</th>
                <th>Durasi</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const dur = hitungDurasiMenit(r.waktu_mulai_layan, r.waktu_selesai);
                return (
                  <tr key={r.id}>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{formatTanggalId(r.tanggal)}</td>
                    <td style={{ fontWeight: 700, color: 'var(--color-primary-700)' }}>{r.nomor_display}</td>
                    <td>{r.kunjungan?.nama ?? '—'}</td>
                    <td><span className="badge badge--draft">{r.kunjungan?.asal ?? '—'}</span></td>
                    <td>{r.petugas?.nama ?? '—'}</td>
                    <td>{formatWaktuId(r.waktu_mulai_layan)}</td>
                    <td>{formatWaktuId(r.waktu_selesai)}</td>
                    <td>{dur != null ? `${dur} mnt` : '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => setSelected(r)}
                        aria-label="Lihat Detail"
                      >
                        <Eye size={14} /> Lihat
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
      </div>

      <RekapTiketDetailPanel tiket={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
