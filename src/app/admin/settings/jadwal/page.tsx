'use client';

import { useState, useEffect, useCallback } from 'react';
import { CalendarDays, Clock, Plus, Trash2, Loader2, Save } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';

interface Layanan {
  id: string;
  nama: string;
  is_ptsp: boolean;
}

interface Jadwal {
  layanan_id: string;
  hari_kerja: number[];
  jam_buka: string;
  jam_tutup: string;
}

interface Libur {
  id: string;
  layanan_id: string;
  tanggal: string;
  keterangan: string | null;
}

const HARI_LABEL = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

export default function AdminJadwalPage() {
  const { toast } = useToast();
  const [layananList, setLayananList] = useState<Layanan[]>([]);
  const [selectedLayananId, setSelectedLayananId] = useState('');
  const [jadwal, setJadwal] = useState<Jadwal | null>(null);
  const [liburList, setLiburList] = useState<Libur[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canEdit, setCanEdit] = useState(false);

  const [liburTanggal, setLiburTanggal] = useState('');
  const [liburKeterangan, setLiburKeterangan] = useState('');

  const loadData = useCallback(async (layananId: string) => {
    const supabase = createClient();
    const [{ data: j }, { data: lb }] = await Promise.all([
      supabase.from('layanan_jadwal').select('*').eq('layanan_id', layananId).maybeSingle(),
      supabase.from('layanan_libur').select('*').eq('layanan_id', layananId).order('tanggal'),
    ]);
    setJadwal(
      j ?? { layanan_id: layananId, hari_kerja: [1, 2, 3, 4, 5], jam_buka: '08:00', jam_tutup: '16:00' },
    );
    setLiburList(lb ?? []);
  }, []);

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: p } = await supabase
          .from('petugas')
          .select('role, layanan:layanan_id(is_ptsp)')
          .eq('auth_user_id', user.id)
          .maybeSingle();
        if (p) {
          const isPtsp = Array.isArray(p.layanan)
            ? p.layanan[0]?.is_ptsp
            : (p.layanan as { is_ptsp: boolean } | null)?.is_ptsp;
          setCanEdit(p.role === 'admin' || !!isPtsp);
        }
      }

      const { data } = await supabase
        .from('layanan')
        .select('id, nama, is_ptsp')
        .order('nama');
      const list = (data ?? []) as Layanan[];
      setLayananList(list);
      if (list.length > 0) {
        setSelectedLayananId(list[0].id);
        await loadData(list[0].id);
      }
      setLoading(false);
    }
    init();
  }, [loadData]);

  const handleSelectLayanan = async (id: string) => {
    setSelectedLayananId(id);
    await loadData(id);
  };

  const toggleHari = (hari: number) => {
    if (!jadwal) return;
    const set = new Set(jadwal.hari_kerja);
    if (set.has(hari)) set.delete(hari);
    else set.add(hari);
    setJadwal({ ...jadwal, hari_kerja: Array.from(set).sort() });
  };

  const handleSaveJadwal = async () => {
    if (!jadwal) return;
    setSaving(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      let petugasId: string | null = null;
      if (user) {
        const { data: p } = await supabase
          .from('petugas').select('id').eq('auth_user_id', user.id).maybeSingle();
        petugasId = p?.id ?? null;
      }
      const { error } = await supabase.from('layanan_jadwal').upsert({
        layanan_id: jadwal.layanan_id,
        hari_kerja: jadwal.hari_kerja,
        jam_buka: jadwal.jam_buka,
        jam_tutup: jadwal.jam_tutup,
        updated_by: petugasId,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      toast('Jadwal layanan disimpan.', 'success');
    } catch {
      toast('Gagal menyimpan jadwal. Pastikan Anda admin atau petugas PTSP.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAddLibur = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!liburTanggal || !selectedLayananId) return;
    try {
      const supabase = createClient();
      const { error } = await supabase.from('layanan_libur').insert({
        layanan_id: selectedLayananId,
        tanggal: liburTanggal,
        keterangan: liburKeterangan.trim() || null,
      });
      if (error) throw error;
      setLiburTanggal('');
      setLiburKeterangan('');
      await loadData(selectedLayananId);
      toast('Tanggal libur ditambahkan.', 'success');
    } catch {
      toast('Gagal menambah tanggal libur (mungkin duplikat).', 'error');
    }
  };

  const handleDeleteLibur = async (id: string) => {
    try {
      const supabase = createClient();
      const { error } = await supabase.from('layanan_libur').delete().eq('id', id);
      if (error) throw error;
      await loadData(selectedLayananId);
      toast('Tanggal libur dihapus.', 'success');
    } catch {
      toast('Gagal menghapus tanggal libur.', 'error');
    }
  };

  if (loading) {
    return (
      <>
        <PageHeader title="Jadwal Layanan" description="Hari kerja, jam operasional, dan tanggal libur per layanan" />
        <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
          <Loader2 size={24} className="animate-pulse" style={{ margin: '0 auto' }} />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Jadwal Layanan"
        description="Atur hari kerja, jam operasional, dan tanggal libur. Antrian (walk-in/reservasi) ditutup saat libur; live chat tetap buka."
      />

      <div style={{ padding: 'var(--space-8)', maxWidth: '860px' }}>
        {!canEdit && (
          <div role="alert" className="form-error" style={{ marginBottom: 'var(--space-4)' }}>
            Anda hanya dapat melihat. Perubahan jadwal hanya bisa dilakukan admin atau petugas PTSP.
          </div>
        )}

        <div className="form-group" style={{ maxWidth: '420px' }}>
          <label className="form-label" htmlFor="jadwalLayanan">Layanan</label>
          <select
            id="jadwalLayanan"
            className="form-input"
            value={selectedLayananId}
            onChange={(e) => handleSelectLayanan(e.target.value)}
          >
            {layananList.map((l) => (
              <option key={l.id} value={l.id}>{l.nama}{l.is_ptsp ? ' (PTSP)' : ''}</option>
            ))}
          </select>
        </div>

        {jadwal && (
          <div className="table-wrapper" style={{ padding: 'var(--space-6)', marginTop: 'var(--space-4)' }}>
            <h3 style={{ marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <CalendarDays size={18} /> Hari Kerja & Jam Operasional
            </h3>

            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
              {HARI_LABEL.map((label, i) => {
                const hari = i + 1;
                const active = jadwal.hari_kerja.includes(hari);
                return (
                  <button
                    key={hari}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => toggleHari(hari)}
                    className={`btn btn--sm ${active ? 'btn--primary' : 'btn--secondary'}`}
                    style={{ minWidth: '56px' }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="jamBuka"><Clock size={12} /> Jam Buka</label>
                <input
                  id="jamBuka" type="time" className="form-input"
                  value={jadwal.jam_buka.slice(0, 5)}
                  disabled={!canEdit}
                  onChange={(e) => setJadwal({ ...jadwal, jam_buka: e.target.value })}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="jamTutup"><Clock size={12} /> Jam Tutup</label>
                <input
                  id="jamTutup" type="time" className="form-input"
                  value={jadwal.jam_tutup.slice(0, 5)}
                  disabled={!canEdit}
                  onChange={(e) => setJadwal({ ...jadwal, jam_tutup: e.target.value })}
                />
              </div>
              {canEdit && (
                <button type="button" className="btn btn--primary" onClick={handleSaveJadwal} disabled={saving}>
                  {saving ? <Loader2 size={16} className="animate-pulse" /> : <Save size={16} />} Simpan Jadwal
                </button>
              )}
            </div>
          </div>
        )}

        <div className="table-wrapper" style={{ padding: 'var(--space-6)', marginTop: 'var(--space-6)' }}>
          <h3 style={{ marginBottom: 'var(--space-4)' }}>Tanggal Libur</h3>

          {canEdit && (
            <form onSubmit={handleAddLibur} style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="liburTanggal">Tanggal</label>
                <input
                  id="liburTanggal" type="date" className="form-input" required
                  value={liburTanggal} onChange={(e) => setLiburTanggal(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: '200px' }}>
                <label className="form-label" htmlFor="liburKeterangan">Keterangan</label>
                <input
                  id="liburKeterangan" type="text" className="form-input"
                  placeholder="Contoh: Hari Raya Idul Fitri"
                  value={liburKeterangan} onChange={(e) => setLiburKeterangan(e.target.value)}
                />
              </div>
              <button type="submit" className="btn btn--primary"><Plus size={16} /> Tambah</button>
            </form>
          )}

          {liburList.length === 0 ? (
            <p style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
              Belum ada tanggal libur khusus untuk layanan ini.
            </p>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Tanggal</th><th>Keterangan</th>{canEdit && <th>Aksi</th>}</tr>
              </thead>
              <tbody>
                {liburList.map((lb) => (
                  <tr key={lb.id}>
                    <td>{new Date(`${lb.tanggal}T00:00:00`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</td>
                    <td>{lb.keterangan || '—'}</td>
                    {canEdit && (
                      <td>
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => handleDeleteLibur(lb.id)}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
