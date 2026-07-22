'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  BookOpen,
  LogIn,
  LogOut as LogOutIcon,
  Calendar,
  UserCheck,
  CheckCircle2,
  Clock,
  XCircle
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Pagination from '@/components/Pagination';
import { createClient } from '@/lib/supabase/client';

const PAGE_SIZE = 25;

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
  status: 'pending' | 'approved' | 'ditolak';
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
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  const fetchData = useCallback(async () => {
    try {
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
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let query = supabase
        .from('absensi_petugas')
        .select(`
          id, petugas_id, tanggal, jam_masuk, jam_pulang, status,
          petugas:petugas_id (
            nama,
            layanan:layanan_id ( nama )
          )
        `, { count: 'exact' })
        .eq('tanggal', filterTanggal)
        .order('jam_masuk', { ascending: false })
        .range(from, to);

      // If just a regular petugas, only show their own attendance for the day?
      // Wait, the UI allows them to see others? Let's just show theirs if petugas, or all if admin
      if (myRole === 'petugas' && myPetugasId) {
         query = query.eq('petugas_id', myPetugasId);
      }

      const { data, count } = await query;
      // Handle the case where the join returns array or object due to how supabase types work
      const formattedData = (data || []).map(d => ({
        ...d,
        petugas: Array.isArray(d.petugas) ? d.petugas[0] : d.petugas
      })) as unknown as Absensi[];
      
      setAbsensi(formattedData);
      setTotalCount(count ?? formattedData.length);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [filterTanggal, page]);

  useEffect(() => {
    void Promise.resolve().then(fetchData);
  }, [fetchData]);

  const handleAbsenHadir = async () => {
    if (!currentUser) return;
    try {
      setActionLoading(true);
      const supabase = createClient();
      await supabase.from('absensi_petugas').insert({
        petugas_id: currentUser.id,
        tanggal: new Date().toISOString().split('T')[0],
        jam_masuk: new Date().toISOString(),
      });
      setLoading(true);
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
      setLoading(true);
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
      setLoading(true);
      await fetchData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleReject = async (id: string) => {
    if (!currentUser || currentUser.role !== 'admin') return;
    try {
      const supabase = createClient();
      await supabase.from('absensi_petugas')
        .update({ status: 'ditolak', approved_by: currentUser.id })
        .eq('id', id);
      setLoading(true);
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
              onChange={(e) => {
                setLoading(true);
                setFilterTanggal(e.target.value);
                setPage(0);
              }}
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
             <table className="table" aria-hidden="true">
               <tbody>
                 {Array.from({ length: 5 }).map((_, i) => (
                   <tr key={i}>
                     <td colSpan={currentUser?.role === 'admin' ? 6 : 5} style={{ padding: 'var(--space-3) var(--space-4)' }}>
                       <div className="skeleton" style={{ height: '20px', width: '100%' }} />
                     </td>
                   </tr>
                 ))}
               </tbody>
             </table>
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
                        <span className="badge badge--selesai">Disetujui</span>
                      ) : a.status === 'ditolak' ? (
                        <span className="badge badge--nonaktif">Ditolak</span>
                      ) : (
                        <span className="badge badge--eskalasi">Menunggu</span>
                      )}
                    </td>
                    {currentUser?.role === 'admin' && (
                      <td>
                        {a.status === 'pending' && (
                          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                            <button
                              className="btn btn--secondary btn--sm"
                              onClick={() => handleApprove(a.id)}
                            >
                              Setujui
                            </button>
                            <button
                              className="btn btn--danger btn--sm"
                              onClick={() => handleReject(a.id)}
                            >
                              <XCircle size={14} />
                              Tolak
                            </button>
                          </div>
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
          {!loading && <Pagination page={page} pageSize={PAGE_SIZE} total={totalCount} onPageChange={setPage} />}
        </div>
      </div>
    </>
  );
}
