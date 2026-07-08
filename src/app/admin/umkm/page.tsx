'use client';

import { useState, useEffect, useCallback } from 'react';
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
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';

interface UMKMListing {
  id: string;
  nama_umkm: string;
  kategori_kebutuhan: KategoriUMKM;
  deskripsi: string | null;
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
  deskripsi: string;
  kontak_nama: string;
  kontak_hp: string;
  kontak_email: string;
}

const emptyForm: FormData = {
  nama_umkm: '',
  kategori_kebutuhan: '',
  deskripsi: '',
  kontak_nama: '',
  kontak_hp: '',
  kontak_email: '',
};

export default function AdminUMKMPage() {
  const [filterStatus, setFilterStatus] = useState<string>('semua');
  const [search, setSearch] = useState('');
  const [umkmList, setUmkmList] = useState<UMKMListing[]>([]);
  const [loading, setLoading] = useState(true);

  // Form states
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Detail modal
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
    } catch (e) {
      console.error('Error loading UMKM:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ---- Status Update (approve / reject / nonaktifkan) ----
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
    } catch (e) {
      console.error('Error updating status:', e);
      alert('Gagal memperbarui status. Silakan coba lagi.');
    }
  };

  // ---- Delete ----
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
    } catch (e) {
      console.error('Error deleting UMKM:', e);
      alert('Gagal menghapus listing. Silakan coba lagi.');
    }
  };

  // ---- Open form for Create or Edit ----
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
      deskripsi: item.deskripsi || '',
      kontak_nama: item.kontak_nama,
      kontak_hp: item.kontak_hp || '',
      kontak_email: item.kontak_email || '',
    });
    setFormError('');
    setShowForm(true);
  };

  // ---- Submit Form (Create or Update) ----
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
        deskripsi: form.deskripsi.trim() || null,
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

        setUmkmList(prev => prev.map(l => l.id === editingId ? { ...l, ...payload } : l));
      } else {
        const { error } = await supabase
          .from('listing_umkm')
          .insert({
            ...payload,
            status: 'draft',
            created_at: new Date().toISOString(),
          });

        if (error) throw error;

        await loadData(); // Reload full list to get the new record with server-generated fields
      }

      setShowForm(false);
      setEditingId(null);
    } catch (e) {
      console.error('Error saving UMKM:', e);
      setFormError('Gagal menyimpan data. Pastikan Anda memiliki akses admin.');
    } finally {
      setSaving(false);
    }
  };

  // ---- Filter ----
  const filtered = umkmList.filter((l) => {
    const matchSearch = l.nama_umkm.toLowerCase().includes(search.toLowerCase()) ||
      (l.deskripsi && l.deskripsi.toLowerCase().includes(search.toLowerCase()));
    const matchStatus = filterStatus === 'semua' || l.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const pendingCount = umkmList.filter(l => l.status === 'pending_review').length;
  const viewedItem = viewingId ? umkmList.find(l => l.id === viewingId) : null;

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
                      {KATEGORI_UMKM[l.kategori_kebutuhan] || l.kategori_kebutuhan}
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
