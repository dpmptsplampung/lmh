'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Search,
  Filter,
  CheckCircle2,
  Clock,
  RefreshCw,
  Loader2,
  Calendar,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';

interface KunjunganRow {
  id: string;
  nama: string;
  keperluan: string | null;
  status: 'menunggu' | 'selesai';
  waktu_masuk: string;
  waktu_selesai: string | null;
  layanan: { nama: string } | { nama: string }[] | null;
}

export default function KunjunganPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'semua' | 'menunggu' | 'selesai'>('semua');
  const [kunjungan, setKunjungan] = useState<KunjunganRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTanggal, setFilterTanggal] = useState(
    new Date().toISOString().split('T')[0]
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const startOfDay = new Date(`${filterTanggal}T00:00:00`);
      const { data, error } = await supabase
        .from('kunjungan')
        .select(`
          id, nama, keperluan, status, waktu_masuk, waktu_selesai,
          layanan:layanan_id ( nama )
        `)
        .gte('waktu_masuk', startOfDay.toISOString())
        .lt('waktu_masuk', new Date(filterTanggal + 'T23:59:59.999Z').toISOString())
        .order('waktu_masuk', { ascending: false });

      if (error) throw error;

      const normalized = (data || []).map(k => ({
        ...k,
        layanan: Array.isArray(k.layanan) ? k.layanan[0] : k.layanan,
      })) as KunjunganRow[];

      setKunjungan(normalized);
    } catch (e) {
      console.error('Error loading kunjungan:', e);
      toast('Gagal memuat data kunjungan', 'error');
    } finally {
      setLoading(false);
    }
  }, [filterTanggal, toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  const handleSelesai = async (id: string) => {
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('kunjungan')
        .update({
          status: 'selesai',
          waktu_selesai: new Date().toISOString(),
        })
        .eq('id', id);

      if (error) throw error;

      setKunjungan(prev => prev.map(k => k.id === id ? { ...k, status: 'selesai', waktu_selesai: new Date().toISOString() } : k));
      toast('Kunjungan berhasil diselesaikan', 'success');
    } catch (e) {
      console.error('Error updating kunjungan:', e);
      toast('Gagal menyelesaikan kunjungan', 'error');
    }
  };

  const filtered = kunjungan.filter((k) => {
    const layananNama = Array.isArray(k.layanan) ? k.layanan[0]?.nama : k.layanan?.nama || '';
    const matchSearch = k.nama.toLowerCase().includes(search.toLowerCase()) ||
      layananNama.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'semua' || k.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  };

  const getLayananNama = (k: KunjunganRow) => {
    if (!k.layanan) return '—';
    if (Array.isArray(k.layanan)) return k.layanan[0]?.nama || '—';
    return k.layanan.nama || '—';
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
              onChange={(e) => setFilterTanggal(e.target.value)}
              style={{ width: '160px', padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)' }}
            />
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {(['semua', 'menunggu', 'selesai'] as const).map((s) => (
              <button
                key={s}
                className={cn('btn btn--sm', filterStatus === s ? 'btn--primary' : 'btn--secondary')}
                onClick={() => setFilterStatus(s)}
              >
                {s === 'semua' && <Filter size={14} />}
                {s === 'menunggu' && <Clock size={14} />}
                {s === 'selesai' && <CheckCircle2 size={14} />}
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="table-wrapper">
          {loading ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              <Loader2 size={24} className="animate-pulse" style={{ margin: '0 auto' }} />
              <p style={{ marginTop: 'var(--space-2)' }}>Memuat data kunjungan...</p>
            </div>
          ) : (
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Nama</th>
                <th>Keperluan</th>
                <th>Layanan</th>
                <th>Waktu Masuk</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((k, i) => (
                <tr key={k.id}>
                  <td style={{ color: 'var(--text-tertiary)' }}>{i + 1}</td>
                  <td style={{ fontWeight: 600 }}>{k.nama}</td>
                  <td style={{ maxWidth: '240px', color: 'var(--text-secondary)' }}>
                    {k.keperluan || '—'}
                  </td>
                  <td>{getLayananNama(k)}</td>
                  <td>{formatTime(k.waktu_masuk)}</td>
                  <td>
                    <span className={`badge badge--${k.status}`}>
                      {k.status === 'menunggu' ? '● Menunggu' : '✓ Selesai'}
                    </span>
                  </td>
                  <td>
                    {k.status === 'menunggu' ? (
                      <button className="btn btn--primary btn--sm" onClick={() => handleSelesai(k.id)}>
                        <CheckCircle2 size={14} />
                        Selesai
                      </button>
                    ) : (
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                        {k.waktu_selesai && formatTime(k.waktu_selesai)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </div>

        {filtered.length === 0 && (
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
