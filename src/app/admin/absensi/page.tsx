'use client';

import { useState, useEffect } from 'react';
import {
  BookOpen,
  LogIn,
  LogOut as LogOutIcon,
  Calendar,
  UserCheck,
  CheckCircle2,
  Clock,
  Loader2
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';

interface PetugasData {
  id: string;
  role: string;
  layanan_id: string;
}

interface Absensi {
  id: string;
  petugas_id: string;
  tanggal: string;
  jam_masuk: string | null;
  jam_pulang: string | null;
  status: 'pending' | 'approved';
  petugas: {
    nama: string;
    layanan: {
      nama: string;
    } | null;
  };
}

export default function AbsensiPage() {
  const [filterTanggal, setFilterTanggal] = useState(new Date().toISOString().split('T')[0]);
  const [absensi, setAbsensi] = useState<Absensi[]>([]);
  const [currentUser, setCurrentUser] = useState<PetugasData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    fetchData();
  }, [filterTanggal]);

  async function fetchData() {
    try {
      setLoading(true);
      const supabase = createClient();
      
      // Get current user role
      const { data: { user } } = await supabase.auth.getUser();
      let myPetugasId = null;
      let myRole = 'petugas';

      if (user) {
        const { data: p } = await supabase
          .from('petugas')
          .select('id, role, layanan_id')
          .eq('auth_user_id', user.id)
          .single();
        if (p) {
          myPetugasId = p.id;
          myRole = p.role;
          setCurrentUser(p as PetugasData);
        }
      }

      // Fetch absensi
      let query = supabase
        .from('absensi_petugas')
        .select(`
          id, petugas_id, tanggal, jam_masuk, jam_pulang, status,
          petugas:petugas_id (
            nama,
            layanan:layanan_id ( nama )
          )
        `)
        .eq('tanggal', filterTanggal)
        .order('jam_masuk', { ascending: false });

      // If just a regular petugas, only show their own attendance for the day?
      // Wait, the UI allows them to see others? Let's just show theirs if petugas, or all if admin
      if (myRole === 'petugas' && myPetugasId) {
         query = query.eq('petugas_id', myPetugasId);
      }

      const { data } = await query;
      // Handle the case where the join returns array or object due to how supabase types work
      const formattedData = (data || []).map(d => ({
        ...d,
        petugas: Array.isArray(d.petugas) ? d.petugas[0] : d.petugas
      })) as Absensi[];
      
      setAbsensi(formattedData);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  const handleAbsenHadir = async () => {
    if (!currentUser) return;
    try {
      setActionLoading(true);
      const supabase = createClient();
      await supabase.from('absensi_petugas').insert({
        petugas_id: currentUser.id,
        tanggal: filterTanggal,
        jam_masuk: new Date().toISOString(),
      });
      await fetchData();
    } catch (e) {
      console.error(e);
    } finally {
      setActionLoading(false);
    }
  };

  const handleAbsenPulang = async () => {
    if (!currentUser) return;
    const todayAbsensi = absensi.find(a => a.petugas_id === currentUser.id);
    if (!todayAbsensi) return;

    try {
      setActionLoading(true);
      const supabase = createClient();
      await supabase.from('absensi_petugas')
        .update({ jam_pulang: new Date().toISOString() })
        .eq('id', todayAbsensi.id);
      await fetchData();
    } catch (e) {
      console.error(e);
    } finally {
      setActionLoading(false);
    }
  };

  const handleApprove = async (id: string) => {
    if (!currentUser || currentUser.role !== 'admin') return;
    try {
      const supabase = createClient();
      await supabase.from('absensi_petugas')
        .update({ status: 'approved', approved_by: currentUser.id })
        .eq('id', id);
      await fetchData();
    } catch (e) {
      console.error(e);
    }
  };

  const hadirHariIni = absensi.length;
  const sudahPulang = absensi.filter(a => a.jam_pulang).length;
  const myTodayAbsensi = absensi.find(a => a.petugas_id === currentUser?.id);

  return (
    <>
      <PageHeader
        title="Absensi Instansi Mitra"
        description="Buku P4 Digital — Pencatatan kehadiran petugas instansi mitra"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
           <Calendar size={16} style={{ color: 'var(--text-tertiary)' }} />
           <input
             type="date"
             className="form-input"
             value={filterTanggal}
             onChange={(e) => setFilterTanggal(e.target.value)}
             style={{ width: '160px', padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)' }}
           />
        </div>
      </PageHeader>

      <div style={{ padding: 'var(--space-8)' }}>
        {/* Tombol Absen Mandiri (Khusus Petugas) */}
        {currentUser?.role === 'petugas' && filterTanggal === new Date().toISOString().split('T')[0] && (
          <div style={{ background: 'var(--surface-elevated)', padding: 'var(--space-6)', borderRadius: 'var(--radius-xl)', marginBottom: 'var(--space-8)', border: '1px solid var(--border-default)' }}>
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, marginBottom: 'var(--space-4)' }}>Absensi Mandiri Hari Ini</h3>
            <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
              {!myTodayAbsensi ? (
                <button className="btn btn--primary" onClick={handleAbsenHadir} disabled={actionLoading}>
                  <LogIn size={18} /> Absen Hadir
                </button>
              ) : (
                <button className="btn btn--secondary" disabled>
                  <CheckCircle2 size={18} style={{ color: 'var(--color-success-500)' }}/> Sudah Hadir
                </button>
              )}
              
              {myTodayAbsensi && !myTodayAbsensi.jam_pulang ? (
                 <button className="btn btn--secondary" onClick={handleAbsenPulang} disabled={actionLoading}>
                   <LogOutIcon size={18} /> Absen Pulang
                 </button>
              ) : myTodayAbsensi?.jam_pulang ? (
                 <button className="btn btn--secondary" disabled>
                   <CheckCircle2 size={18} style={{ color: 'var(--text-tertiary)' }}/> Sudah Pulang
                 </button>
              ) : null}
            </div>
            
            {myTodayAbsensi && myTodayAbsensi.status === 'pending' && (
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-warning-600)', marginTop: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <Clock size={14} /> Absensi Anda sedang menunggu persetujuan (approval) Admin.
              </p>
            )}
          </div>
        )}

        {/* Stats */}
        <div className="grid-stats" style={{ marginBottom: 'var(--space-8)' }}>
          <div className="stat-card">
            <div className="stat-card__icon" style={{ background: 'var(--color-primary-50)', color: 'var(--color-primary-600)' }}>
              <UserCheck size={22} />
            </div>
            <span className="stat-card__value">{hadirHariIni}</span>
            <span className="stat-card__label">Hadir Hari Ini</span>
          </div>
          <div className="stat-card">
            <div className="stat-card__icon" style={{ background: 'var(--color-success-50)', color: 'var(--color-success-600)' }}>
              <LogOutIcon size={22} />
            </div>
            <span className="stat-card__value">{sudahPulang}</span>
            <span className="stat-card__label">Sudah Pulang</span>
          </div>
        </div>

        {/* Table */}
        <div className="table-wrapper">
          {loading ? (
             <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-tertiary)' }}>
               <Loader2 size={24} className="animate-pulse" style={{ margin: '0 auto' }} />
               <p style={{ marginTop: 'var(--space-2)' }}>Memuat data absensi...</p>
             </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Instansi / Layanan</th>
                  <th>Nama Petugas</th>
                  <th>Jam Hadir</th>
                  <th>Jam Pulang</th>
                  <th>Status</th>
                  {currentUser?.role === 'admin' && <th>Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {absensi.map((a) => {
                  // Fallback for nested data structure depending on how supabase joins
                  const layananNama = a.petugas?.layanan ? (Array.isArray(a.petugas.layanan) ? a.petugas.layanan[0]?.nama : (a.petugas.layanan as { nama: string }).nama) : 'Semua Layanan';
                  const petugasNama = a.petugas?.nama || 'Petugas';
                  
                  return (
                  <tr key={a.id}>
                    <td style={{ fontWeight: 600 }}>{layananNama}</td>
                    <td>{petugasNama}</td>
                    <td>
                      {a.jam_masuk ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                          <LogIn size={14} style={{ color: 'var(--color-success-500)' }} />
                          {new Date(a.jam_masuk).toLocaleTimeString('id-ID', { hour: '2-digit', minute:'2-digit' })}
                        </span>
                      ) : '—'}
                    </td>
                    <td>
                      {a.jam_pulang ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                          <LogOutIcon size={14} style={{ color: 'var(--text-tertiary)' }} />
                          {new Date(a.jam_pulang).toLocaleTimeString('id-ID', { hour: '2-digit', minute:'2-digit' })}
                        </span>
                      ) : '—'}
                    </td>
                    <td>
                      {a.status === 'approved' ? (
                        <span className="badge badge--selesai">Approved</span>
                      ) : (
                        <span className="badge badge--eskalasi">Pending</span>
                      )}
                    </td>
                    {currentUser?.role === 'admin' && (
                      <td>
                        {a.status === 'pending' && (
                           <button 
                             className="btn btn--secondary btn--sm" 
                             onClick={() => handleApprove(a.id)}
                           >
                             Approve
                           </button>
                        )}
                      </td>
                    )}
                  </tr>
                )})}
                {absensi.length === 0 && (
                  <tr>
                    <td colSpan={currentUser?.role === 'admin' ? 6 : 5}>
                      <div className="empty-state" style={{ padding: 'var(--space-8)' }}>
                        <BookOpen size={40} className="empty-state__icon" />
                        <h3 className="empty-state__title">Belum Ada Absensi</h3>
                        <p>Tidak ada catatan absensi untuk tanggal ini.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
