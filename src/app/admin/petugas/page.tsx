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
  role: 'petugas' | 'admin' | 'front_office';
  layanan_id: string | null;
  layanan?: { nama: string } | { nama: string }[] | null;
  aktif: boolean;
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
  const [editRole, setEditRole] = useState<'petugas' | 'admin' | 'front_office'>('petugas');
  const [editLayananId, setEditLayananId] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: petugasData }, { data: layananData }] = await Promise.all([
      supabase
        .from('petugas')
        .select('id, auth_user_id, nama, role, layanan_id, aktif, created_at, layanan:layanan_id(nama)')
        .order('created_at', { ascending: false }),
      supabase.from('layanan').select('id, nama').order('nama'),
    ]);
    setRows((petugasData ?? []) as PetugasRow[]);
    setLayananList((layananData ?? []) as LayananOption[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  // RBA-08: nonaktifkan (FO/Admin, wajib alasan, satu arah untuk FO).
  const handleNonaktifkan = async (row: PetugasRow) => {
    const alasan = window.prompt(`Alasan menonaktifkan akun "${row.nama}"? (wajib, tercatat)`);
    if (!alasan || !alasan.trim()) {
      toast('Alasan wajib diisi.', 'error');
      return;
    }
    try {
      const res = await fetch('/api/admin/petugas/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aksi: 'nonaktifkan', petugas_id: row.id, alasan: alasan.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Gagal');
      toast(`Akun ${row.nama} dinonaktifkan.`, 'success');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal menonaktifkan.', 'error');
    }
  };

  // RBA-08: aktifkan kembali (hanya Admin).
  const handleAktifkan = async (row: PetugasRow) => {
    try {
      const res = await fetch('/api/admin/petugas/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aksi: 'aktifkan', petugas_id: row.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Gagal');
      toast(`Akun ${row.nama} diaktifkan kembali.`, 'success');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal mengaktifkan.', 'error');
    }
  };

  // RBA-07: pergantian PIC (reset password + akhiri sesi lama). Hanya Admin.
  const handleGantiPic = async (row: PetugasRow) => {
    const email = window.prompt(
      `Ganti pemegang akun "${row.nama}" (${layananNama(row)}).\nMasukkan email pemegang BARU.\nSesi pemegang lama akan diakhiri.`,
    );
    if (!email || !email.includes('@')) {
      toast('Email pemegang baru valid diperlukan.', 'error');
      return;
    }
    if (!window.confirm(`Kirim undangan ke ${email} dan akhiri sesi pemegang lama?`)) return;
    try {
      const res = await fetch('/api/admin/petugas/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aksi: 'ganti_pic', petugas_id: row.id, email_baru: email.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Gagal');
      toast(json.pesan ?? 'Undangan dikirim.', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal mengganti PIC.', 'error');
    }
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
                  <th>Status</th>
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
                          onChange={(e) => setEditRole(e.target.value as 'petugas' | 'admin' | 'front_office')}
                          aria-label="Role"
                        >
                          <option value="petugas">Petugas</option>
                          <option value="admin">Admin</option>
                          <option value="front_office">Front Office</option>
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
                      <td>
                        {row.aktif === false ? (
                          <span className="badge badge--nonaktif">Nonaktif</span>
                        ) : (
                          <span className="badge badge--selesai">Aktif</span>
                        )}
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
                    <tr key={row.id} style={row.aktif === false ? { opacity: 0.55 } : undefined}>
                      <td style={{ fontWeight: 600 }}>{row.nama}</td>
                      <td>
                        <span className={`badge badge--${row.role === 'admin' ? 'aktif' : 'draft'}`}>
                          {row.role === 'admin' ? 'Admin' : row.role === 'front_office' ? 'Front Office' : 'Petugas'}
                        </span>
                      </td>
                      <td>{layananNama(row)}</td>
                      <td>
                        {row.aktif === false ? (
                          <span className="badge badge--nonaktif">Nonaktif</span>
                        ) : (
                          <span className="badge badge--selesai">Aktif</span>
                        )}
                      </td>
                      <td>{new Date(row.created_at).toLocaleDateString('id-ID')}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={() => startEdit(row)}
                          >
                            Ubah
                          </button>
                          {row.aktif !== false ? (
                            <button
                              type="button"
                              className="btn btn--danger btn--sm"
                              onClick={() => handleNonaktifkan(row)}
                              title="Nonaktifkan (FO/Admin, wajib alasan)"
                            >
                              Nonaktifkan
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn--secondary btn--sm"
                              onClick={() => handleAktifkan(row)}
                              title="Aktifkan kembali (hanya Admin)"
                            >
                              Aktifkan
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => handleGantiPic(row)}
                            title="Ganti pemegang akun / PIC (hanya Admin)"
                          >
                            Ganti PIC
                          </button>
                        </div>
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
