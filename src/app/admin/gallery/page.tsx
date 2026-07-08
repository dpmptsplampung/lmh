'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  Upload,
  Eye,
  EyeOff,
  GripVertical,
  Trash2,
  RefreshCw,
  X,
  Save,
  Plus,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';

interface GalleryDoc {
  id: string;
  judul: string;
  kategori: string | null;
  urutan_tampil: number;
  jumlah_halaman: number;
  status: 'aktif' | 'nonaktif';
  deskripsi: string | null;
  nilai_investasi: string | null;
  image_url: string | null;
  created_at: string;
  updated_at: string;
}

const emptyForm = {
  judul: '',
  kategori: '',
  urutan_tampil: 1,
  jumlah_halaman: 0,
  deskripsi: '',
  nilai_investasi: '',
  image_url: '',
  status: 'aktif' as 'aktif' | 'nonaktif',
};

export default function AdminGalleryPage() {
  const [docs, setDocs] = useState<GalleryDoc[]>([]);
  const [loading, setLoading] = useState(true);

  // Form modal state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Detail modal
  const [viewingDoc, setViewingDoc] = useState<GalleryDoc | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('investment_documents')
        .select('*')
        .order('urutan_tampil', { ascending: true });
      if (error) throw error;
      setDocs((data || []) as GalleryDoc[]);
    } catch (e) {
      console.error('Error loading gallery:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleToggleStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'aktif' ? 'nonaktif' : 'aktif';
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('investment_documents')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      setDocs(prev => prev.map(d => d.id === id ? { ...d, status: newStatus as 'aktif' | 'nonaktif' } : d));
    } catch (e) {
      console.error('Error toggling status:', e);
      alert('Gagal mengubah status.');
    }
  };

  const handleDelete = async (id: string, judul: string) => {
    if (!confirm(`Hapus dokumen "${judul}"? Tindakan ini tidak dapat dibatalkan.`)) return;
    try {
      const supabase = createClient();
      const { error } = await supabase.from('investment_documents').delete().eq('id', id);
      if (error) throw error;
      setDocs(prev => prev.filter(d => d.id !== id));
    } catch (e) {
      console.error('Error deleting doc:', e);
      alert('Gagal menghapus dokumen.');
    }
  };

  const handleOpenForm = (doc?: GalleryDoc) => {
    if (doc) {
      setEditingId(doc.id);
      setForm({
        judul: doc.judul,
        kategori: doc.kategori ?? '',
        urutan_tampil: doc.urutan_tampil,
        jumlah_halaman: doc.jumlah_halaman,
        deskripsi: doc.deskripsi ?? '',
        nilai_investasi: doc.nilai_investasi ?? '',
        image_url: doc.image_url ?? '',
        status: doc.status,
      });
    } else {
      setEditingId(null);
      setForm({ ...emptyForm, urutan_tampil: docs.length + 1 });
    }
    setFormError('');
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.judul.trim()) {
      setFormError('Judul wajib diisi.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const supabase = createClient();
      const payload = {
        judul: form.judul.trim(),
        kategori: form.kategori.trim() || null,
        urutan_tampil: form.urutan_tampil,
        jumlah_halaman: form.jumlah_halaman,
        deskripsi: form.deskripsi.trim() || null,
        nilai_investasi: form.nilai_investasi.trim() || null,
        image_url: form.image_url.trim() || null,
        status: form.status,
        updated_at: new Date().toISOString(),
        // file_path is required by schema — use placeholder for now
        ...(!editingId ? { file_path: 'pending-upload' } : {}),
      };

      if (editingId) {
        const { error } = await supabase
          .from('investment_documents')
          .update(payload)
          .eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('investment_documents')
          .insert(payload);
        if (error) throw error;
      }
      setShowForm(false);
      loadData();
    } catch (e: any) {
      console.error('Error saving doc:', e);
      setFormError(e.message ?? 'Gagal menyimpan dokumen.');
    } finally {
      setSaving(false);
    }
  };

  const aktifCount = docs.filter(d => d.status === 'aktif').length;
  const nonaktifCount = docs.filter(d => d.status === 'nonaktif').length;

  return (
    <>
      <PageHeader
        title="Investment Gallery"
        description="Kelola dokumen galeri investasi — upload metadata, atur urutan tampil"
      >
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn--ghost btn--sm" onClick={loadData}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button className="btn btn--primary btn--sm" onClick={() => handleOpenForm()}>
            <Plus size={16} />
            Tambah Dokumen
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
        {loading ? (
          <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: 'var(--space-8)' }}>Memuat data...</p>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: '40px' }}></th>
                  <th>Dokumen</th>
                  <th>Kategori</th>
                  <th>Nilai Investasi</th>
                  <th>Halaman</th>
                  <th>Urutan</th>
                  <th>Status</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {docs.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 'var(--space-8)' }}>
                      Belum ada dokumen. Klik "Tambah Dokumen" untuk menambahkan.
                    </td>
                  </tr>
                ) : docs.map((doc) => (
                  <tr key={doc.id}>
                    <td>
                      <GripVertical size={16} style={{ color: 'var(--text-tertiary)', cursor: 'grab' }} />
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                        {doc.image_url ? (
                          <img src={doc.image_url} alt={doc.judul} style={{ width: 40, height: 48, objectFit: 'cover', borderRadius: 'var(--radius-sm)', flexShrink: 0 }} />
                        ) : (
                          <div style={{ width: '40px', height: '48px', borderRadius: 'var(--radius-sm)', background: 'var(--color-primary-50)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <FileText size={20} style={{ color: 'var(--color-primary-600)' }} />
                          </div>
                        )}
                        <div>
                          <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{doc.judul}</span>
                          {doc.deskripsi && (
                            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.deskripsi}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      {doc.kategori && <span className="badge badge--draft">{doc.kategori}</span>}
                    </td>
                    <td style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: '#f59e0b' }}>
                      {doc.nilai_investasi ?? '—'}
                    </td>
                    <td style={{ fontSize: 'var(--text-sm)' }}>{doc.jumlah_halaman} hal</td>
                    <td style={{ fontSize: 'var(--text-sm)', textAlign: 'center' }}>{doc.urutan_tampil}</td>
                    <td>
                      <span className={`badge badge--${doc.status}`}>
                        {doc.status === 'aktif' ? '✓ Aktif' : 'Nonaktif'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <button className="btn btn--ghost btn--sm" title="Detail" onClick={() => setViewingDoc(doc)}>
                          <Eye size={14} />
                        </button>
                        <button className="btn btn--ghost btn--sm" title="Edit" onClick={() => handleOpenForm(doc)}>
                          <Upload size={14} />
                        </button>
                        <button
                          className="btn btn--ghost btn--sm"
                          title={doc.status === 'aktif' ? 'Nonaktifkan' : 'Aktifkan'}
                          onClick={() => handleToggleStatus(doc.id, doc.status)}
                        >
                          {doc.status === 'aktif' ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                        <button
                          className="btn btn--ghost btn--sm"
                          title="Hapus"
                          style={{ color: 'var(--color-danger-500)' }}
                          onClick={() => handleDelete(doc.id, doc.judul)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div style={{ background: 'var(--color-neutral-0)', borderRadius: 'var(--radius-xl)', padding: 'var(--space-6)', width: '100%', maxWidth: 540, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-5)' }}>
              <h3 style={{ fontWeight: 700 }}>{editingId ? 'Edit Dokumen' : 'Tambah Dokumen Baru'}</h3>
              <button className="btn btn--ghost btn--sm" onClick={() => setShowForm(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div className="form-group">
                <label className="form-label form-label--required">Judul Proyek / Dokumen</label>
                <input className="form-input" value={form.judul} onChange={e => setForm(f => ({ ...f, judul: e.target.value }))} required />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                <div className="form-group">
                  <label className="form-label">Kategori</label>
                  <input className="form-input" placeholder="e.g. Manufaktur & Industri" value={form.kategori} onChange={e => setForm(f => ({ ...f, kategori: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Nilai Investasi</label>
                  <input className="form-input" placeholder="e.g. Rp 2.4 Triliun" value={form.nilai_investasi} onChange={e => setForm(f => ({ ...f, nilai_investasi: e.target.value }))} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Deskripsi Singkat</label>
                <textarea className="form-input" rows={3} value={form.deskripsi} onChange={e => setForm(f => ({ ...f, deskripsi: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">URL Gambar Thumbnail</label>
                <input className="form-input" type="url" placeholder="https://..." value={form.image_url} onChange={e => setForm(f => ({ ...f, image_url: e.target.value }))} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                <div className="form-group">
                  <label className="form-label">Urutan Tampil</label>
                  <input className="form-input" type="number" min={1} value={form.urutan_tampil} onChange={e => setForm(f => ({ ...f, urutan_tampil: Number(e.target.value) }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select className="form-input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as 'aktif' | 'nonaktif' }))}>
                    <option value="aktif">Aktif</option>
                    <option value="nonaktif">Nonaktif</option>
                  </select>
                </div>
              </div>
              {formError && <p className="form-error">{formError}</p>}
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn--ghost" onClick={() => setShowForm(false)}>Batal</button>
                <button type="submit" className="btn btn--primary" disabled={saving}>
                  <Save size={16} />
                  {saving ? 'Menyimpan...' : 'Simpan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail View Modal */}
      {viewingDoc && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div style={{ background: 'var(--color-neutral-0)', borderRadius: 'var(--radius-xl)', padding: 'var(--space-6)', width: '100%', maxWidth: 480 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
              <h3 style={{ fontWeight: 700, fontSize: 'var(--text-base)' }}>Detail Dokumen</h3>
              <button className="btn btn--ghost btn--sm" onClick={() => setViewingDoc(null)}><X size={18} /></button>
            </div>
            {viewingDoc.image_url && (
              <img src={viewingDoc.image_url} alt={viewingDoc.judul} style={{ width: '100%', height: 180, objectFit: 'cover', borderRadius: 'var(--radius-lg)', marginBottom: 'var(--space-4)' }} />
            )}
            <h2 style={{ fontWeight: 700, marginBottom: 'var(--space-2)' }}>{viewingDoc.judul}</h2>
            {viewingDoc.kategori && <span className="badge badge--draft" style={{ marginBottom: 'var(--space-3)', display: 'inline-block' }}>{viewingDoc.kategori}</span>}
            {viewingDoc.nilai_investasi && <p style={{ color: '#f59e0b', fontWeight: 700, marginBottom: 'var(--space-2)' }}>{viewingDoc.nilai_investasi}</p>}
            {viewingDoc.deskripsi && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{viewingDoc.deskripsi}</p>}
            <div style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--border-default)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              {viewingDoc.jumlah_halaman} halaman · Urutan #{viewingDoc.urutan_tampil} · {viewingDoc.status}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
