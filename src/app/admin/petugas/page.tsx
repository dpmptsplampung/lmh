'use client';

import { useState, useEffect, useCallback } from 'react';
import { UserPlus, Loader2, Save, X } from 'lucide-react';
import Link from 'next/link';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';

interface PetugasRow {
  id: string;
  auth_user_id: string;
  nama: string;
  role: 'petugas' | 'admin';
  layanan_id: string | null;
  layanan?: { nama: string } | { nama: string }[] | null;
  created_at: string;
}

interface LayananOption {
  id: string;
  nama: string;
}

export default function AdminPetugasPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<PetugasRow[]>([]);
  const [layananList, setLayananList] = useState<LayananOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNama, setEditNama] = useState('');
  const [editRole, setEditRole] = useState<'petugas' | 'admin'>('petugas');
  const [editLayananId, setEditLayananId] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: petugasData }, { data: layananData }] = await Promise.all([
      supabase
        .from('petugas')
        .select('id, auth_user_id, nama, role, layanan_id, created_at, layanan:layanan_id(nama)')
        .order('created_at', { ascending: false }),
      supabase.from('layanan').select('id, nama').order('nama'),
    ]);
    setRows((petugasData ?? []) as PetugasRow[]);
    setLayananList((layananData ?? []) as LayananOption[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startEdit = (row: PetugasRow) => {
    setEditingId(row.id);
    setEditNama(row.nama);
    setEditRole(row.role);
    setEditLayananId(row.layanan_id ?? '');
  };

  const handleSave = async () => {
    if (!editingId) return;
    if (editRole === 'petugas' && !editLayananId) {
      toast('Petugas wajib memiliki layanan.', 'error');
      return;
    }
    setSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('petugas')
        .update({
          nama: editNama.trim(),
          role: editRole,
          layanan_id: editRole === 'admin' ? editLayananId || null : editLayananId,
        })
        .eq('id', editingId);
      if (error) throw error;
      toast('Data petugas diperbarui.', 'success');
      setEditingId(null);
      await load();
    } catch {
      toast('Gagal menyimpan. Hanya admin yang dapat mengubah data petugas.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const layananNama = (row: PetugasRow) => {
    const l = Array.isArray(row.layanan) ? row.layanan[0] : row.layanan;
    return l?.nama ?? '—';
  };

  return (
    <>
      <PageHeader
        title="Kelola Petugas"
        description="Daftar akun petugas, ubah penugasan layanan atau role"
      >
        <Link href="/admin/petugas/invite" className="btn btn--primary btn--sm">
          <UserPlus size={14} /> Undang Petugas
        </Link>
      </PageHeader>

      <div style={{ padding: 'var(--space-8)' }}>
        <div className="table-wrapper">
          {loading ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
              <Loader2 size={24} className="animate-pulse" style={{ margin: '0 auto' }} />
            </div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              Belum ada petugas terdaftar.
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Nama</th>
                  <th>Role</th>
                  <th>Layanan</th>
                  <th>Terdaftar</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) =>
                  editingId === row.id ? (
                    <tr key={row.id}>
                      <td>
                        <input
                          className="form-input"
                          value={editNama}
                          onChange={(e) => setEditNama(e.target.value)}
                          aria-label="Nama petugas"
                        />
                      </td>
                      <td>
                        <select
                          className="form-input"
                          value={editRole}
                          onChange={(e) => setEditRole(e.target.value as 'petugas' | 'admin')}
                          aria-label="Role"
                        >
                          <option value="petugas">Petugas</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td>
                        <select
                          className="form-input"
                          value={editLayananId}
                          onChange={(e) => setEditLayananId(e.target.value)}
                          aria-label="Layanan"
                        >
                          <option value="">{editRole === 'admin' ? '— Tanpa layanan —' : '— Pilih layanan —'}</option>
                          {layananList.map((l) => (
                            <option key={l.id} value={l.id}>{l.nama}</option>
                          ))}
                        </select>
                      </td>
                      <td>{new Date(row.created_at).toLocaleDateString('id-ID')}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            onClick={handleSave}
                            disabled={saving}
                          >
                            {saving ? <Loader2 size={14} className="animate-pulse" /> : <Save size={14} />}
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => setEditingId(null)}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={row.id}>
                      <td style={{ fontWeight: 600 }}>{row.nama}</td>
                      <td>
                        <span className={`badge badge--${row.role === 'admin' ? 'aktif' : 'draft'}`}>
                          {row.role === 'admin' ? 'Admin' : 'Petugas'}
                        </span>
                      </td>
                      <td>{layananNama(row)}</td>
                      <td>{new Date(row.created_at).toLocaleDateString('id-ID')}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => startEdit(row)}
                        >
                          Ubah
                        </button>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
