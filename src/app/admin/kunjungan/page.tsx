'use client';

import { useState, useEffect } from 'react';
import {
  Search,
  Filter,
  CheckCircle2,
  Clock,
  RefreshCw,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';

export default function KunjunganPage() {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'semua' | 'menunggu' | 'selesai'>('semua');
  const [kunjungan, setKunjungan] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    const supabase = createClient();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfDay = today.toISOString();

    const { data } = await supabase
      .from('kunjungan')
      .select('*, layanan(nama)')
      .gte('waktu_masuk', startOfDay)
      .order('waktu_masuk', { ascending: false });

    if (data) {
      setKunjungan(data.map(k => ({
        ...k,
        layanan: k.layanan?.nama || '-'
      })));
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSelesai = async (id: string) => {
    const supabase = createClient();
    const { error } = await supabase
      .from('kunjungan')
      .update({ status: 'selesai', waktu_selesai: new Date().toISOString() })
      .eq('id', id);

    if (!error) {
      loadData();
    }
  };

  const filtered = kunjungan.filter((k) => {
    const matchSearch = k.nama.toLowerCase().includes(search.toLowerCase()) ||
      k.layanan.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'semua' || k.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
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
                  <td>{k.layanan}</td>
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
