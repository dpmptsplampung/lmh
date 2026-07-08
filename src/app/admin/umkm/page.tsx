'use client';

import { useState, useEffect } from 'react';
import {
  Store,
  Search,
  Eye,
  CheckCircle2,
  XCircle,
  Clock,
  Filter,
  RefreshCw,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { KATEGORI_UMKM, type KategoriUMKM } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';

export default function AdminUMKMPage() {
  const [filterStatus, setFilterStatus] = useState<string>('semua');
  const [search, setSearch] = useState('');
  const [umkmList, setUmkmList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase.from('umkm').select('*').order('created_at', { ascending: false });
    if (data) {
      setUmkmList(data);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleUpdateStatus = async (id: string, newStatus: string) => {
    const supabase = createClient();
    const { error } = await supabase.from('umkm').update({ status: newStatus }).eq('id', id);
    if (!error) {
      loadData();
    }
  };

  const filtered = umkmList.filter((l) => {
    const matchSearch = l.nama_umkm.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'semua' || l.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const pendingCount = umkmList.filter(l => l.status === 'pending_review').length;

  return (
    <>
      <PageHeader
        title="Kelola UMKM"
        description="Review dan kelola listing Matchmaking UMKM"
      >
        <button className="btn btn--ghost btn--sm" onClick={loadData}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </PageHeader>

      <div style={{ padding: 'var(--space-8)' }}>
        {/* Stats */}
        {pendingCount > 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            padding: 'var(--space-4) var(--space-5)',
            background: 'var(--color-accent-50)',
            border: '1px solid var(--color-accent-200)',
            borderRadius: 'var(--radius-lg)',
            marginBottom: 'var(--space-6)',
            fontSize: 'var(--text-sm)',
          }}>
            <Clock size={18} style={{ color: 'var(--color-accent-600)' }} />
            <span><strong>{pendingCount}</strong> listing menunggu review Anda</span>
          </div>
        )}

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
              placeholder="Cari nama UMKM..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: '40px' }}
            />
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            {['semua', 'pending_review', 'published', 'draft', 'nonaktif'].map((s) => (
              <button
                key={s}
                className={cn('btn btn--sm', filterStatus === s ? 'btn--primary' : 'btn--secondary')}
                onClick={() => setFilterStatus(s)}
              >
                {s === 'semua' ? 'Semua' :
                  s === 'pending_review' ? `Pending (${pendingCount})` :
                    s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>UMKM</th>
                <th>Kategori</th>
                <th>Kontak</th>
                <th>Tanggal</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => (
                <tr key={l.id}>
                  <td>
                    <div>
                      <div style={{ fontWeight: 600 }}>{l.nama_umkm}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {l.deskripsi}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="badge badge--draft">
                      {KATEGORI_UMKM[l.kategori as KategoriUMKM] || l.kategori}
                    </span>
                  </td>
                  <td style={{ fontSize: 'var(--text-sm)' }}>{l.kontak_nama}</td>
                  <td style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                    {new Date(l.created_at).toLocaleDateString('id-ID')}
                  </td>
                  <td>
                    <span className={`badge badge--${l.status === 'pending_review' ? 'pending' : l.status}`}>
                      {l.status === 'pending_review' ? '● Pending' :
                        l.status === 'published' ? '✓ Published' :
                          l.status === 'draft' ? 'Draft' : l.status}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <button className="btn btn--ghost btn--sm" title="Lihat">
                        <Eye size={14} />
                      </button>
                      {l.status === 'pending_review' && (
                        <>
                          <button 
                            className="btn btn--primary btn--sm" 
                            title="Approve"
                            onClick={() => handleUpdateStatus(l.id, 'published')}
                          >
                            <CheckCircle2 size={14} />
                          </button>
                          <button 
                            className="btn btn--ghost btn--sm" 
                            title="Tolak" 
                            style={{ color: 'var(--color-danger-500)' }}
                            onClick={() => handleUpdateStatus(l.id, 'nonaktif')}
                          >
                            <XCircle size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
