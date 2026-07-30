'use client';

// WP-22: Reads migrated from visit → kunjungan + tiket_antrean.
// visit remains the write source; dual-write trigger keeps kunjungan in sync.

import { useState, useEffect, useCallback } from 'react';
import { todayWIB } from '@/lib/time';
import {
  Search,
  Filter,
  CheckCircle2,
  Clock,
  RefreshCw,
  Calendar,
  Info,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Pagination from '@/components/Pagination';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';

const PAGE_SIZE = 25;

interface TiketData {
  nomor_display: string | null;
  waktu_selesai: string | null;
  layanan: { nama: string } | { nama: string }[] | null;
}

interface KunjunganRow {
  id: string;
  nama: string;
  asal: string;
  status: 'terjadwal' | 'menunggu' | 'dilayani' | 'selesai' | 'tidak_terlayani' | 'no_show';
  waktu_masuk: string | null;
  tanggal: string;
  tiket_antrean: TiketData[] | TiketData | null;
}

export default function KunjunganPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'semua' | 'menunggu' | 'dilayani' | 'selesai'>('semua');
  const [kunjungan, setKunjungan] = useState<KunjunganRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [filterTanggal, setFilterTanggal] = useState(todayWIB());

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      // WP-22: query kunjungan filtered by tanggal (date column, Asia/Jakarta-aware).
      // tiket_antrean joined for layanan name, nomor_display, and waktu_selesai.
      const { data, count, error } = await supabase
        .from('kunjungan')
        .select(`
          id, nama, asal, status, waktu_masuk, tanggal,
          tiket_antrean(nomor_display, waktu_selesai, layanan:layanan_id(nama))
        `, { count: 'exact' })
        .eq('tanggal', filterTanggal)
        .order('waktu_masuk', { ascending: false, nullsFirst: false })
        .range(from, to);

      if (error) throw error;

      // Normalize tiket_antrean to always be an array
      const normalized = (data || []).map(k => ({
        ...k,
        tiket_antrean: Array.isArray(k.tiket_antrean)
          ? k.tiket_antrean
          : (k.tiket_antrean ? [k.tiket_antrean] : []),
      })) as KunjunganRow[];

      setKunjungan(normalized);
      setTotalCount(count ?? normalized.length);
    } catch (e) {
      console.error('Error loading kunjungan:', e);
      toast('Gagal memuat data kunjungan', 'error');
    } finally {
      setLoading(false);
    }
  }, [filterTanggal, page, toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  const getTiket = (k: KunjunganRow): TiketData | null => {
    const arr = Array.isArray(k.tiket_antrean) ? k.tiket_antrean : (k.tiket_antrean ? [k.tiket_antrean] : []);
    return arr[0] ?? null;
  };

  const getLayananNama = (k: KunjunganRow): string => {
    const t = getTiket(k);
    if (!t?.layanan) return '—';
    if (Array.isArray(t.layanan)) return t.layanan[0]?.nama || '—';
    return t.layanan.nama || '—';
  };

  const getNomorDisplay = (k: KunjunganRow): string => {
    return getTiket(k)?.nomor_display ?? '—';
  };

  const getWaktuSelesai = (k: KunjunganRow): string | null => {
    return getTiket(k)?.waktu_selesai ?? null;
  };

  const filtered = kunjungan.filter((k) => {
    const layananNama = getLayananNama(k);
    const matchSearch = k.nama.toLowerCase().includes(search.toLowerCase()) ||
      layananNama.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'semua' || k.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const formatTime = (iso: string | null) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case 'menunggu': return '● Menunggu';
      case 'dilayani': return 'Sedang Dilayani';
      case 'selesai': return '✓ Selesai';
      case 'terjadwal': return '◷ Terjadwal';
      case 'tidak_terlayani': return '✗ Tidak Terlayani';
      case 'no_show': return '○ Tidak Datang';
      default: return status;
    }
  };

  return (
    <>
      <PageHeader
        title="Kelola Kunjungan"
        description="Daftar pengunjung yang telah check-in hari ini"
      >
        <button className="btn btn--ghost btn--sm" onClick={loadData}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </PageHeader>

      <div style={{ padding: 'var(--space-8)' }}>
        {/* Filters */}
        <div style={{ display: 'flex', gap: 'var(--space-4)', marginBottom: 'var(--space-6)', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
            <Search size={18} style={{
              position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)',
              color: 'var(--text-tertiary)'
            }} />
            <input
              type="text"
              className="form-input"
              placeholder="Cari nama atau layanan..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: '40px' }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Calendar size={18} style={{ color: 'var(--text-tertiary)' }} />
            <input
              type="date"
              className="form-input"
              value={filterTanggal}
              onChange={(e) => { setFilterTanggal(e.target.value); setPage(0); }}
              style={{ width: '160px', padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)' }}
            />
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {(['semua', 'menunggu', 'dilayani', 'selesai'] as const).map((s) => (
              <button
                key={s}
                className={cn('btn btn--sm', filterStatus === s ? 'btn--primary' : 'btn--secondary')}
                onClick={() => setFilterStatus(s)}
              >
                {s === 'semua' && <Filter size={14} />}
                {s === 'menunggu' && <Clock size={14} />}
                {s === 'dilayani' && <Clock size={14} />}
                {s === 'selesai' && <CheckCircle2 size={14} />}
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Info bar */}
        <div
          role="note"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            padding: 'var(--space-3) var(--space-4)',
            marginBottom: 'var(--space-4)',
            background: 'var(--color-primary-50)',
            color: 'var(--color-primary-700)',
            borderRadius: 'var(--radius-lg)',
            fontSize: 'var(--text-sm)',
          }}
        >
          <Info size={16} />
          Penyelesaian layanan dilakukan di menu Antrian.
        </div>

        {/* Table */}
        <div className="table-wrapper">
          {loading ? (
            <table className="table" aria-hidden="true">
              <tbody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={7} style={{ padding: 'var(--space-3) var(--space-4)' }}>
                      <div className="skeleton" style={{ height: '20px', width: '100%' }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>No. Tiket</th>
                <th>Nama</th>
                <th>Layanan</th>
                <th>Waktu Masuk</th>
                <th>Waktu Selesai</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((k, i) => (
                <tr key={k.id}>
                  <td style={{ color: 'var(--text-tertiary)' }}>{page * PAGE_SIZE + i + 1}</td>
                  <td style={{ fontWeight: 600, color: 'var(--color-primary-700)' }}>{getNomorDisplay(k)}</td>
                  <td style={{ fontWeight: 600 }}>{k.nama}</td>
                  <td>{getLayananNama(k)}</td>
                  <td>{formatTime(k.waktu_masuk)}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>
                    {formatTime(getWaktuSelesai(k))}
                  </td>
                  <td>
                    <span className={`badge badge--${k.status}`}>
                      {statusLabel(k.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
          {!loading && <Pagination page={page} pageSize={PAGE_SIZE} total={totalCount} onPageChange={setPage} />}
        </div>

        {filtered.length === 0 && !loading && (
          <div className="empty-state">
            <Search size={48} className="empty-state__icon" />
            <h3 className="empty-state__title">Tidak Ada Data</h3>
            <p>Belum ada kunjungan yang sesuai filter.</p>
          </div>
        )}
      </div>
    </>
  );
}