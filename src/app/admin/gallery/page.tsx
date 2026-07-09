'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import {
  FileText,
  Eye,
  EyeOff,
  Trash2,
  RefreshCw,
  X,
  Save,
  Plus,
  Edit2,
  ChevronUp,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';

interface GalleryDoc {
  id: string;
  judul: string;
  kategori: string | null;
  urutan_tampil: number;
  file_path: string;
  jumlah_halaman: number;
  status: 'aktif' | 'nonaktif';
  deskripsi: string | null;
  nilai_investasi: string | null;
  image_url: string | null;
  created_at: string;
  updated_at: string;
}

interface GalleryForm {
  judul: string;
  kategori: string;
  urutan_tampil: number;
  jumlah_halaman: number;
  deskripsi: string;
  nilai_investasi: string;
  image_url: string;
  file_path: string;
  status: 'aktif' | 'nonaktif';
}

const emptyForm: GalleryForm = {
  judul: '',
  kategori: '',
  urutan_tampil: 1,
  jumlah_halaman: 0,
  deskripsi: '',
  nilai_investasi: '',
  image_url: '',
  file_path: '',
  status: 'aktif',
};

export default function AdminGalleryPage() {
  const { toast } = useToast();
  const [docs, setDocs] = useState<GalleryDoc[]>([]);
  const [loading, setLoading] = useState(true);

  // Form modal state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<GalleryForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [uploadingFile, setUploadingFile] = useState(false);

  // Detail modal
  const [viewingDoc, setViewingDoc] = useState<GalleryDoc | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loadingSignedUrl, setLoadingSignedUrl] = useState(false);

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
    } catch {
      toast('Gagal memuat data galeri. Silakan coba lagi.', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      toast(`Status berhasil diubah menjadi ${newStatus}.`, 'success');
    } catch {
      toast('Gagal mengubah status dokumen.', 'error');
    }
  };

  const handleDelete = async (id: string, judul: string) => {
    if (!confirm(`Hapus dokumen "${judul}"? Tindakan ini tidak dapat dibatalkan.`)) return;
    try {
      const supabase = createClient();
      const { error } = await supabase.from('investment_documents').delete().eq('id', id);
      if (error) throw error;
      setDocs(prev => prev.filter(d => d.id !== id));
      toast('Dokumen berhasil dihapus.', 'success');
    } catch {
      toast('Gagal menghapus dokumen.', 'error');
    }
  };

  const handlePdfUpload = async (file: File) => {
    if (file.type !== 'application/pdf') {
      toast('File harus berupa PDF.', 'warning');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast('Ukuran file maksimal 10MB.', 'warning');
      return;
    }

    setUploadingFile(true);
    try {
      const supabase = createClient();
      const path = `${crypto.randomUUID()}.pdf`;
      const { error: uploadError } = await supabase.storage
        .from('investment-docs')
        .upload(path, file);

      if (uploadError) throw uploadError;

      setForm(prev => ({ ...prev, file_path: path }));
      toast('PDF berhasil diunggah.', 'success');
    } catch {
      toast('Gagal mengunggah PDF. Silakan coba lagi.', 'error');
    } finally {
      setUploadingFile(false);
    }
  };

  const handleMoveUp = async (doc: GalleryDoc) => {
    const sorted = [...docs].sort((a, b) => a.urutan_tampil - b.urutan_tampil);
    const index = sorted.findIndex(d => d.id === doc.id);
    if (index <= 0) return;

    const prevDoc = sorted[index - 1];
    const prevOrder = prevDoc.urutan_tampil;
    const currOrder = doc.urutan_tampil;

    try {
      const supabase = createClient();
      const { error: err1 } = await supabase
        .from('investment_documents')
        .update({ urutan_tampil: currOrder, updated_at: new Date().toISOString() })
        .eq('id', prevDoc.id);
      if (err1) throw err1;

      const { error: err2 } = await supabase
        .from('investment_documents')
        .update({ urutan_tampil: prevOrder, updated_at: new Date().toISOString() })
        .eq('id', doc.id);
      if (err2) throw err2;

      setDocs(prev => prev.map(d => {
        if (d.id === prevDoc.id) return { ...d, urutan_tampil: currOrder };
        if (d.id === doc.id) return { ...d, urutan_tampil: prevOrder };
        return d;
      }));
    } catch {
      toast('Gagal mengubah urutan dokumen.', 'error');
    }
  };

  const handleMoveDown = async (doc: GalleryDoc) => {
    const sorted = [...docs].sort((a, b) => a.urutan_tampil - b.urutan_tampil);
    const index = sorted.findIndex(d => d.id === doc.id);
    if (index < 0 || index >= sorted.length - 1) return;

    const nextDoc = sorted[index + 1];
    const nextOrder = nextDoc.urutan_tampil;
    const currOrder = doc.urutan_tampil;

    try {
      const supabase = createClient();
      const { error: err1 } = await supabase
        .from('investment_documents')
        .update({ urutan_tampil: currOrder, updated_at: new Date().toISOString() })
        .eq('id', nextDoc.id);
      if (err1) throw err1;

      const { error: err2 } = await supabase
        .from('investment_documents')
        .update({ urutan_tampil: nextOrder, updated_at: new Date().toISOString() })
        .eq('id', doc.id);
      if (err2) throw err2;

      setDocs(prev => prev.map(d => {
        if (d.id === nextDoc.id) return { ...d, urutan_tampil: currOrder };
        if (d.id === doc.id) return { ...d, urutan_tampil: nextOrder };
        return d;
      }));
    } catch {
      toast('Gagal mengubah urutan dokumen.', 'error');
    }
  };

  const handleViewDoc = async (doc: GalleryDoc) => {
    setViewingDoc(doc);
    setSignedUrl(null);
    setLoadingSignedUrl(true);
    try {
      const res = await fetch('/api/investment-docs/signed-url?file_path=' + encodeURIComponent(doc.file_path));
      if (!res.ok) throw new Error('Failed to fetch signed URL');
      const data = await res.json();
      setSignedUrl(data.signedUrl);
    } catch {
      toast('Gagal memuat pratinjau PDF.', 'error');
    } finally {
      setLoadingSignedUrl(false);
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
        file_path: doc.file_path,
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
    if (!editingId && !form.file_path) {
      setFormError('File PDF wajib diunggah.');
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
        ...(!editingId ? { file_path: form.file_path } : {}),
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
      toast('Dokumen berhasil disimpan.', 'success');
      loadData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal menyimpan dokumen.';
      setFormError(message);
      toast(message, 'error');
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
                      Belum ada dokumen. Klik &quot;Tambah Dokumen&quot; untuk menambahkan.
                    </td>
                  </tr>
                ) : docs.map((doc, idx) => (
                  <tr key={doc.id}>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <button
                          className="btn btn--ghost btn--sm"
                          title="Pindah ke atas"
                          disabled={idx === 0}
                          style={{ padding: '2px', opacity: idx === 0 ? 0.3 : 1, cursor: idx === 0 ? 'default' : 'pointer' }}
                          onClick={() => handleMoveUp(doc)}
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          className="btn btn--ghost btn--sm"
                          title="Pindah ke bawah"
                          disabled={idx === docs.length - 1}
                          style={{ padding: '2px', opacity: idx === docs.length - 1 ? 0.3 : 1, cursor: idx === docs.length - 1 ? 'default' : 'pointer' }}
                          onClick={() => handleMoveDown(doc)}
                        >
                          <ChevronDown size={14} />
                        </button>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                        {doc.image_url ? (
                          <Image
                            src={doc.image_url}
                            alt={doc.judul}
                            width={40}
                            height={48}
                            style={{ objectFit: 'cover', borderRadius: 'var(--radius-sm)', flexShrink: 0 }}
                            unoptimized
                          />
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
                        <button className="btn btn--ghost btn--sm" title="Detail" onClick={() => handleViewDoc(doc)}>
                          <Eye size={14} />
                        </button>
                        <button className="btn btn--ghost btn--sm" title="Edit" onClick={() => handleOpenForm(doc)}>
                          <Edit2 size={14} />
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
              <div className="form-group">
                <label className="form-label form-label--required">File PDF</label>
                <input
                  type="file"
                  accept="application/pdf"
                  className="form-input"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) handlePdfUpload(file);
                  }}
                  disabled={uploadingFile}
                />
                <span className="form-hint">Maksimal 10MB, format PDF</span>
                {uploadingFile && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
                    <Loader2 size={16} className="animate-spin" />
                    Mengunggah PDF...
                  </div>
                )}
                {form.file_path && !uploadingFile && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-success-700)', fontSize: 'var(--text-sm)' }}>
                    <FileText size={16} />
                    {form.file_path.split('/').pop()}
                  </div>
                )}
                {editingId && form.file_path && (
                  <span className="form-hint">File saat ini: {form.file_path.split('/').pop()}</span>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-4)' }}>
                <div className="form-group">
                  <label className="form-label">Jumlah Halaman</label>
                  <input className="form-input" type="number" min={0} value={form.jumlah_halaman} onChange={e => setForm(f => ({ ...f, jumlah_halaman: Number(e.target.value) }))} />
                </div>
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
          <div style={{ background: 'var(--color-neutral-0)', borderRadius: 'var(--radius-xl)', padding: 'var(--space-6)', width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
              <h3 style={{ fontWeight: 700, fontSize: 'var(--text-base)' }}>Detail Dokumen</h3>
              <button className="btn btn--ghost btn--sm" onClick={() => { setViewingDoc(null); setSignedUrl(null); }}><X size={18} /></button>
            </div>
            {viewingDoc.image_url && (
              <Image
                src={viewingDoc.image_url}
                alt={viewingDoc.judul}
                width={640}
                height={180}
                style={{ width: '100%', height: 180, objectFit: 'cover', borderRadius: 'var(--radius-lg)', marginBottom: 'var(--space-4)' }}
                unoptimized
              />
            )}
            <h2 style={{ fontWeight: 700, marginBottom: 'var(--space-2)' }}>{viewingDoc.judul}</h2>
            {viewingDoc.kategori && <span className="badge badge--draft" style={{ marginBottom: 'var(--space-3)', display: 'inline-block' }}>{viewingDoc.kategori}</span>}
            {viewingDoc.nilai_investasi && <p style={{ color: '#f59e0b', fontWeight: 700, marginBottom: 'var(--space-2)' }}>{viewingDoc.nilai_investasi}</p>}
            {viewingDoc.deskripsi && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 'var(--space-3)' }}>{viewingDoc.deskripsi}</p>}
            <div style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              {viewingDoc.jumlah_halaman} halaman · Urutan #{viewingDoc.urutan_tampil} · {viewingDoc.status}
            </div>
            <div className="form-group">
              <label className="form-label">Pratinjau PDF</label>
              {loadingSignedUrl ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 500, background: 'var(--color-neutral-50)', borderRadius: 'var(--radius-md)' }}>
                  <Loader2 size={24} className="animate-spin" style={{ color: 'var(--text-secondary)' }} />
                </div>
              ) : signedUrl ? (
                <>
                  <style>{`@media print { .pdf-preview-frame { display: none !important; }`}</style>
                  <iframe
                    src={signedUrl}
                    className="pdf-preview-frame"
                    style={{ width: '100%', height: '500px', border: 'none', borderRadius: 'var(--radius-md)' }}
                    onContextMenu={(e) => e.preventDefault()}
                    title="PDF Preview"
                  />
                </>
              ) : (
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>PDF tidak tersedia untuk pratinjau.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
