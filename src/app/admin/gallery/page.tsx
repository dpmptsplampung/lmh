'use client';

import { useState, useEffect } from 'react';
import {
  FileText,
  Upload,
  Eye,
  EyeOff,
  GripVertical,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';

export default function AdminGalleryPage() {
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase.from('gallery_docs').select('*').order('urutan', { ascending: true });
    if (data) {
      setDocs(data);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleToggleStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'aktif' ? 'nonaktif' : 'aktif';
    const supabase = createClient();
    const { error } = await supabase.from('gallery_docs').update({ status: newStatus }).eq('id', id);
    if (!error) {
      loadData();
    }
  };

  const aktifCount = docs.filter(d => d.status === 'aktif').length;
  const nonaktifCount = docs.filter(d => d.status === 'nonaktif').length;

  return (
    <>
      <PageHeader
        title="Investment Gallery"
        description="Kelola dokumen galeri investasi — upload PDF, atur urutan tampil"
      >
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn--ghost btn--sm" onClick={loadData}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button className="btn btn--primary btn--sm">
            <Upload size={16} />
            Upload Dokumen
          </button>
        </div>
      </PageHeader>

      <div style={{ padding: 'var(--space-8)' }}>
        {/* Stats */}
        <div className="grid-stats" style={{ marginBottom: 'var(--space-8)' }}>
          <div className="stat-card">
            <div className="stat-card__icon" style={{ background: 'var(--color-primary-50)', color: 'var(--color-primary-600)' }}>
              <FileText size={22} />
            </div>
            <span className="stat-card__value">{aktifCount}</span>
            <span className="stat-card__label">Dokumen Aktif</span>
          </div>
          <div className="stat-card">
            <div className="stat-card__icon" style={{ background: 'var(--color-neutral-100)', color: 'var(--color-neutral-600)' }}>
              <EyeOff size={22} />
            </div>
            <span className="stat-card__value">{nonaktifCount}</span>
            <span className="stat-card__label">Nonaktif</span>
          </div>
        </div>

        {/* Table */}
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '40px' }}></th>
                <th>Dokumen</th>
                <th>Kategori</th>
                <th>Halaman</th>
                <th>Upload</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <GripVertical size={16} style={{ color: 'var(--text-tertiary)', cursor: 'grab' }} />
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <div style={{
                        width: '40px',
                        height: '48px',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--color-primary-50)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}>
                        <FileText size={20} style={{ color: 'var(--color-primary-600)' }} />
                      </div>
                      <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{doc.judul}</span>
                    </div>
                  </td>
                  <td>
                    <span className="badge badge--draft">{doc.kategori}</span>
                  </td>
                  <td style={{ fontSize: 'var(--text-sm)' }}>{doc.halaman} hal</td>
                  <td style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                    {new Date(doc.uploaded_at).toLocaleDateString('id-ID')}
                  </td>
                  <td>
                    <span className={`badge badge--${doc.status}`}>
                      {doc.status === 'aktif' ? '✓ Aktif' : 'Nonaktif'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <button className="btn btn--ghost btn--sm" title="Lihat">
                        <Eye size={14} />
                      </button>
                      <button 
                        className="btn btn--ghost btn--sm" 
                        title={doc.status === 'aktif' ? 'Nonaktifkan' : 'Aktifkan'}
                        onClick={() => handleToggleStatus(doc.id, doc.status)}
                      >
                        {doc.status === 'aktif' ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                      <button className="btn btn--ghost btn--sm" title="Hapus" style={{ color: 'var(--color-danger-500)' }}>
                        <Trash2 size={14} />
                      </button>
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
