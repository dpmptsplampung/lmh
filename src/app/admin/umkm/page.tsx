'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import {
  Store,
  Search,
  Eye,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Plus,
  Edit2,
  Trash2,
  Loader2,
  X,
  Save,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { KATEGORI_UMKM, type KategoriUMKM } from '@/lib/constants';
import { cn, waLink } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';

interface UMKMListing {
  id: string;
  nama_umkm: string;
  kategori_kebutuhan: KategoriUMKM;
  sisi: 'kebutuhan' | 'penawaran';
  deskripsi: string | null;
  foto_produk: string[] | null;
  kontak_nama: string;
  kontak_hp: string | null;
  kontak_email: string | null;
  status: string;
  edit_token: string;
  created_at: string;
  updated_at: string;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  pending_review: '● Pending',
  published: '✓ Published',
  nonaktif: 'Nonaktif',
  expired: 'Expired',
};

interface FormData {
  nama_umkm: string;
  kategori_kebutuhan: KategoriUMKM | '';
  sisi: 'kebutuhan' | 'penawaran';
  deskripsi: string;
  kontak_nama: string;
  kontak_hp: string;
  kontak_email: string;
  foto_produk: string[];
}

const emptyForm: FormData = {
  nama_umkm: '',
  kategori_kebutuhan: '',
  sisi: 'kebutuhan',
  deskripsi: '',
  kontak_nama: '',
  kontak_hp: '',
  kontak_email: '',
  foto_produk: [],
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.5)',
  backdropFilter: 'blur(4px)',
  WebkitBackdropFilter: 'blur(4px)',
  zIndex: 1200,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '16px',
};

const modalCardStyle: React.CSSProperties = {
  background: 'var(--color-neutral-0, #fff)',
  borderRadius: 'var(--radius-xl, 16px)',
  padding: 'var(--space-6, 24px)',
  width: '100%',
  maxWidth: 600,
  maxHeight: '90vh',
  overflowY: 'auto',
  boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
};

export default function AdminUMKMPage() {
  const { toast } = useToast();
  const [filterStatus, setFilterStatus] = useState<string>('semua');
  const [search, setSearch] = useState('');
  const [umkmList, setUmkmList] = useState<UMKMListing[]>([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [uploadingPhotos, setUploadingPhotos] = useState(false);

  const [viewingId, setViewingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('listing_umkm')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setUmkmList((data || []) as UMKMListing[]);
    } catch {
      toast('Gagal memuat data UMKM. Silakan coba lagi.', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  const handleUpdateStatus = async (id: string, newStatus: string) => {
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('listing_umkm')
        .update({
          status: newStatus,
          updated_at: new Date().toISOString(),
          ...(newStatus === 'published' ? { snapshot_approved: null } : {}),
        })
        .eq('id', id);

      if (error) throw error;

      setUmkmList(prev => prev.map(l => l.id === id ? { ...l, status: newStatus } : l));
      toast(`Status UMKM berhasil diperbarui menjadi ${STATUS_LABELS[newStatus] || newStatus}`, 'success');
    } catch {
      toast('Gagal memperbarui status. Silakan coba lagi.', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Hapus listing UMKM ini? Tindakan ini tidak bisa dibatalkan.')) return;

    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('listing_umkm')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setUmkmList(prev => prev.filter(l => l.id !== id));
      toast('Listing UMKM berhasil dihapus.', 'success');
    } catch {
      toast('Gagal menghapus listing. Silakan coba lagi.', 'error');
    }
  };

  const handleOpenCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError('');
    setShowForm(true);
  };

  const handleOpenEdit = (item: UMKMListing) => {
    setEditingId(item.id);
    setForm({
      nama_umkm: item.nama_umkm,
      kategori_kebutuhan: item.kategori_kebutuhan,
      sisi: item.sisi === 'penawaran' ? 'penawaran' : 'kebutuhan',
      deskripsi: item.deskripsi || '',
      kontak_nama: item.kontak_nama,
      kontak_hp: item.kontak_hp || '',
      kontak_email: item.kontak_email || '',
      foto_produk: item.foto_produk || [],
    });
    setFormError('');
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormError('');
  };

  const handlePhotoUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const currentCount = form.foto_produk.length;
    if (currentCount + files.length > 8) {
      toast('Maksimal 8 foto', 'warning');
      return;
    }

    const validFiles: File[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) {
        toast('File harus berupa gambar', 'warning');
        continue;
      }
      if (file.size > 2 * 1024 * 1024) {
        toast('Ukuran foto maksimal 2MB', 'warning');
        continue;
      }
      validFiles.push(file);
    }

    if (validFiles.length === 0) return;
    if (currentCount + validFiles.length > 8) {
      toast('Maksimal 8 foto', 'warning');
      return;
    }

    setUploadingPhotos(true);
    try {
      const supabase = createClient();
      const newUrls: string[] = [];

      for (const file of validFiles) {
        const ext = file.name.split('.').pop() || 'jpg';
        const path = `${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('umkm-photos')
          .upload(path, file);

        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage
          .from('umkm-photos')
          .getPublicUrl(path);

        newUrls.push(publicUrlData.publicUrl);
      }

      setForm(prev => ({
        ...prev,
        foto_produk: [...prev.foto_produk, ...newUrls],
      }));
      toast(`${newUrls.length} foto berhasil diunggah.`, 'success');
    } catch {
      toast('Gagal mengunggah foto. Silakan coba lagi.', 'error');
    } finally {
      setUploadingPhotos(false);
    }
  };

  const handleRemovePhoto = (index: number) => {
    setForm(prev => ({
      ...prev,
      foto_produk: prev.foto_produk.filter((_, i) => i !== index),
    }));
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!form.nama_umkm.trim()) {
      setFormError('Nama UMKM wajib diisi');
      return;
    }
    if (!form.kategori_kebutuhan) {
      setFormError('Pilih kategori kebutuhan');
      return;
    }
    if (!form.kontak_nama.trim()) {
      setFormError('Nama kontak wajib diisi');
      return;
    }

    setSaving(true);
    try {
      const supabase = createClient();

      const payload = {
        nama_umkm: form.nama_umkm.trim(),
        kategori_kebutuhan: form.kategori_kebutuhan,
        sisi: form.sisi,
        deskripsi: form.deskripsi.trim() || null,
        foto_produk: form.foto_produk,
        kontak_nama: form.kontak_nama.trim(),
        kontak_hp: form.kontak_hp.trim() || null,
        kontak_email: form.kontak_email.trim() || null,
        updated_at: new Date().toISOString(),
      };

      if (editingId) {
        const { error } = await supabase
          .from('listing_umkm')
          .update(payload)
          .eq('id', editingId);

        if (error) throw error;

        setUmkmList(prev => prev.map(l => l.id === editingId ? { ...l, ...payload } as UMKMListing : l));
        toast('UMKM berhasil diperbarui.', 'success');
      } else {
        const { error } = await supabase
          .from('listing_umkm')
          .insert({
            ...payload,
            status: 'draft',
            created_at: new Date().toISOString(),
          });

        if (error) throw error;

        toast('UMKM berhasil ditambahkan.', 'success');
        await loadData();
      }

      setShowForm(false);
      setEditingId(null);
    } catch {
      setFormError('Gagal menyimpan data. Pastikan Anda memiliki akses admin.');
      toast('Gagal menyimpan data. Pastikan Anda memiliki akses admin.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCopyToken = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      toast('Edit token berhasil disalin.', 'success');
    } catch {
      toast('Gagal menyalin token.', 'error');
    }
  };

  const filtered = umkmList.filter((l) => {
    const matchSearch = l.nama_umkm.toLowerCase().includes(search.toLowerCase()) ||
      (l.deskripsi && l.deskripsi.toLowerCase().includes(search.toLowerCase()));
    const matchStatus = filterStatus === 'semua' || l.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const pendingCount = umkmList.filter(l => l.status === 'pending_review').length;
  const viewedItem = viewingId ? umkmList.find(l => l.id === viewingId) : null;

  const statusBadgeClass = (status: string) =>
    `badge badge--${status === 'pending_review' ? 'pending' : status}`;

  const statusBadgeLabel = (status: string) =>
    STATUS_LABELS[status] || status;

  return (
    <>
      <PageHeader
        title="Kelola UMKM"
        description="Review dan kelola listing Matchmaking UMKM"
      >
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button className="btn btn--ghost btn--sm" onClick={loadData}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button className="btn btn--primary btn--sm" onClick={handleOpenCreate}>
            <Plus size={16} />
            Tambah UMKM
          </button>
        </div>
      </PageHeader>

      <div style={{ padding: 'var(--space-8)' }}>
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

        {loading ? (
          <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: 'var(--space-8)' }}>
            Memuat data...
          </p>
        ) : filtered.length === 0 ? (
          <p style={{ color: 'var(--text-tertiary)', textAlign: 'center', padding: 'var(--space-8)' }}>
            Belum ada listing UMKM. Klik &quot;Tambah UMKM&quot; untuk menambahkan.
          </p>
        ) : (
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
                        {KATEGORI_UMKM[l.kategori_kebutuhan] || l.kategori_kebutuhan}
                      </span>
                    </td>
                    <td style={{ fontSize: 'var(--text-sm)' }}>{l.kontak_nama}</td>
                    <td style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                      {new Date(l.created_at).toLocaleDateString('id-ID')}
                    </td>
                    <td>
                      <span className={statusBadgeClass(l.status)}>
                        {statusBadgeLabel(l.status)}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <button
                          className="btn btn--ghost btn--sm"
                          title="Lihat"
                          onClick={() => setViewingId(l.id)}
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          className="btn btn--ghost btn--sm"
                          title="Edit"
                          onClick={() => handleOpenEdit(l)}
                        >
                          <Edit2 size={14} />
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
                        {l.status === 'draft' && (
                          <button
                            className="btn btn--primary btn--sm"
                            title="Publish"
                            onClick={() => handleUpdateStatus(l.id, 'published')}
                          >
                            <CheckCircle2 size={14} /> Publish
                          </button>
                        )}
                        <button
                          className="btn btn--ghost btn--sm"
                          title="Hapus"
                          style={{ color: 'var(--color-danger-500)' }}
                          onClick={() => handleDelete(l.id)}
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

      {showForm && (
        <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) handleCloseForm(); }}>
          <div style={modalCardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-5)' }}>
              <h3 style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <Store size={20} />
                {editingId ? 'Edit UMKM' : 'Tambah UMKM'}
              </h3>
              <button className="btn btn--ghost btn--sm" onClick={handleCloseForm}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmitForm} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div className="form-group">
                <label className="form-label form-label--required" htmlFor="admin-umkm-nama">Nama UMKM</label>
                <input
                  id="admin-umkm-nama"
                  className="form-input"
                  value={form.nama_umkm}
                  onChange={e => setForm(f => ({ ...f, nama_umkm: e.target.value }))}
                  placeholder="Masukkan nama UMKM"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label form-label--required" htmlFor="admin-umkm-kategori">Kategori Kebutuhan</label>
                <select
                  id="admin-umkm-kategori"
                  className="form-input"
                  value={form.kategori_kebutuhan}
                  onChange={e => setForm(f => ({ ...f, kategori_kebutuhan: e.target.value as KategoriUMKM }))}
                  required
                >
                  <option value="">Pilih kategori...</option>
                  {Object.entries(KATEGORI_UMKM).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label form-label--required" htmlFor="admin-umkm-sisi">Sisi</label>
                <select
                  id="admin-umkm-sisi"
                  className="form-input"
                  value={form.sisi}
                  onChange={e => setForm(f => ({ ...f, sisi: e.target.value as 'kebutuhan' | 'penawaran' }))}
                  required
                >
                  <option value="kebutuhan">Kebutuhan</option>
                  <option value="penawaran">Penawaran</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Deskripsi</label>
                <textarea
                  className="form-input"
                  rows={6}
                  value={form.deskripsi}
                  onChange={e => setForm(f => ({ ...f, deskripsi: e.target.value }))}
                  placeholder="Deskripsi kebutuhan UMKM..."
                />
              </div>

                <div className="form-group">
                  <label className="form-label form-label--required" htmlFor="admin-umkm-kontak">Nama Kontak</label>
                  <input
                    id="admin-umkm-kontak"
                    className="form-input"
                    value={form.kontak_nama}
                    onChange={e => setForm(f => ({ ...f, kontak_nama: e.target.value }))}
                    placeholder="Nama orang yang bisa dihubungi"
                    required
                  />
                </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                <div className="form-group">
                  <label className="form-label">No. HP / WhatsApp</label>
                  <input
                    className="form-input"
                    value={form.kontak_hp}
                    onChange={e => setForm(f => ({ ...f, kontak_hp: e.target.value }))}
                    placeholder="08xxxxxxxxxx"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input
                    className="form-input"
                    type="email"
                    value={form.kontak_email}
                    onChange={e => setForm(f => ({ ...f, kontak_email: e.target.value }))}
                    placeholder="email@contoh.com"
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Foto Produk</label>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="form-input"
                  onChange={e => handlePhotoUpload(e.target.files)}
                  disabled={uploadingPhotos}
                />
                <span className="form-hint">Maksimal 8 foto, masing-masing maks 2MB</span>

                {uploadingPhotos && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
                    <Loader2 size={16} className="animate-spin" />
                    Mengunggah foto...
                  </div>
                )}

                {form.foto_produk.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                    {form.foto_produk.map((url, index) => (
                      <div key={index} style={{ position: 'relative', width: 80, height: 80 }}>
                        <Image
                          src={url}
                          alt={`Foto ${index + 1}`}
                          width={80}
                          height={80}
                          style={{ objectFit: 'cover', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)' }}
                          unoptimized
                        />
                        <button
                          type="button"
                          onClick={() => handleRemovePhoto(index)}
                          style={{
                            position: 'absolute',
                            top: '-6px',
                            right: '-6px',
                            width: 22,
                            height: 22,
                            borderRadius: '50%',
                            background: 'var(--color-danger-500)',
                            color: '#fff',
                            border: 'none',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 0,
                          }}
                          aria-label="Hapus foto"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {formError && <p className="form-error">{formError}</p>}

              <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn--ghost" onClick={handleCloseForm}>
                  <X size={16} />
                  Batal
                </button>
                <button type="submit" className="btn btn--primary" disabled={saving}>
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  {saving ? 'Menyimpan...' : 'Simpan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewedItem && (
        <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) setViewingId(null); }}>
          <div style={modalCardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-4)' }}>
              <div>
                <h3 style={{ fontWeight: 700, fontSize: 'var(--text-xl)', marginBottom: 'var(--space-2)' }}>
                  {viewedItem.nama_umkm}
                </h3>
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <span className="badge badge--draft">
                    {KATEGORI_UMKM[viewedItem.kategori_kebutuhan] || viewedItem.kategori_kebutuhan}
                  </span>
                  <span className={statusBadgeClass(viewedItem.status)}>
                    {statusBadgeLabel(viewedItem.status)}
                  </span>
                </div>
              </div>
              <button className="btn btn--ghost btn--sm" onClick={() => setViewingId(null)}>
                <X size={18} />
              </button>
            </div>

            {viewedItem.deskripsi && (
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 'var(--space-4)' }}>
                {viewedItem.deskripsi}
              </p>
            )}

            {viewedItem.foto_produk && viewedItem.foto_produk.length > 0 && (
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>Foto Produk</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--space-3)' }}>
                  {viewedItem.foto_produk.map((url, index) => (
                    <Image
                      key={index}
                      src={url}
                      alt={`Foto produk ${index + 1}`}
                      width={200}
                      height={200}
                      style={{ objectFit: 'cover', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)', width: '100%', height: 200 }}
                      unoptimized
                    />
                  ))}
                </div>
              </div>
            )}

            <div style={{
              padding: 'var(--space-4)',
              background: 'var(--color-neutral-50, #f9fafb)',
              borderRadius: 'var(--radius-lg)',
              marginBottom: 'var(--space-4)',
            }}>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-3)' }}>Informasi Kontak</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', fontSize: 'var(--text-sm)' }}>
                <div><strong>Nama:</strong> {viewedItem.kontak_nama}</div>
                {viewedItem.kontak_hp && (
                  <div>
                    <strong>HP:</strong>{' '}
                    <a href={waLink(viewedItem.kontak_hp)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary-600)' }}>
                      {viewedItem.kontak_hp} (WhatsApp)
                    </a>
                  </div>
                )}
                {viewedItem.kontak_email && (
                  <div>
                    <strong>Email:</strong>{' '}
                    <a href={`mailto:${viewedItem.kontak_email}`} style={{ color: 'var(--color-primary-600)' }}>
                      {viewedItem.kontak_email}
                    </a>
                  </div>
                )}
              </div>
            </div>

            <div style={{
              padding: 'var(--space-4)',
              background: 'var(--color-neutral-50, #f9fafb)',
              borderRadius: 'var(--radius-lg)',
              marginBottom: 'var(--space-4)',
            }}>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-3)' }}>Metadata</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', fontSize: 'var(--text-sm)' }}>
                <div>
                  <strong>Edit Token:</strong>{' '}
                  <code style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)', background: 'var(--color-neutral-100)', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }}>
                    {viewedItem.edit_token}
                  </code>
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => handleCopyToken(viewedItem.edit_token)}
                    style={{ marginLeft: 'var(--space-2)', padding: '2px 8px' }}
                  >
                    Salin
                  </button>
                </div>
                <div><strong>Dibuat:</strong> {new Date(viewedItem.created_at).toLocaleString('id-ID')}</div>
                <div><strong>Diperbarui:</strong> {new Date(viewedItem.updated_at).toLocaleString('id-ID')}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
