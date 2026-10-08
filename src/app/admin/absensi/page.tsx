'use client';

import { useState, useEffect, useCallback } from 'react';
import { todayWIB } from '@/lib/time';
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
import { useToast } from '@/components/Toast';
import AbsensiWizardModal from '@/components/admin/AbsensiWizardModal';

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
  status: 'pending' | 'approved' | 'ditolak' | 'alpa';
  petugas: {
    nama: string;
    layanan: {
      nama: string;
    } | null;
  };
}

export default function AbsensiPage() {
  const { toast } = useToast();
  const [filterTanggal, setFilterTanggal] = useState(todayWIB());
  const [absensi, setAbsensi] = useState<Absensi[]>([]);
  const [currentUser, setCurrentUser] = useState<PetugasData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [foWizardOpen, setFoWizardOpen] = useState(false);

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
    if (!currentUser || actionLoading) return;
    try {
      setActionLoading(true);
      const supabase = createClient();
      // SCH-08/I-09: jam absensi dari SERVER via catat_absensi(), bukan dari klien.
      const { error } = await supabase.rpc('catat_absensi', {
        p_petugas_id: currentUser.id,
        p_sumber: 'petugas_ajukan',
        p_dicatat_oleh: currentUser.id,
      });
      if (error) {
        // 42501 = ditolak RLS/fungsi DB (bukan staf aktif / bukan untuk diri sendiri).
        toast(
          error.code === '42501'
            ? 'Anda tidak berhak mengajukan absensi ini. Hubungi Front Office atau Admin.'
            : 'Gagal mengajukan absensi hadir. Coba lagi.',
          'error',
        );
        return;
      }
      toast('Absensi hadir diajukan. Menunggu persetujuan Front Office/Admin.', 'success');
      setLoading(true);
      await fetchData();
    } catch (e) {
      console.error(e);
      toast('Gagal mengajukan absensi hadir. Coba lagi.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleAbsenPulang = async () => {
    if (!currentUser) return;

    try {
      setActionLoading(true);
      const supabase = createClient();
      // T-7: jam_pulang dari SERVER via RPC catat_pulang() yang menggunakan now() PostgreSQL (I-09)
      const { error } = await supabase.rpc('catat_pulang', { p_petugas_id: currentUser.id });
      if (error) throw error;
      toast('Absen pulang berhasil dicatat', 'success');
      setLoading(true);
      await fetchData();
    } catch (e) {
      console.error(e);
      toast('Gagal mencatat absen pulang', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // FO & Admin boleh memutuskan absensi (SCH-08) — HANYA lewat RPC setujui_absensi
  // (tabel absensi_petugas tidak lagi di-UPDATE langsung dari klien).
  const handleDecision = async (id: string, status: 'approved' | 'ditolak') => {
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'front_office')) return;
    if (decidingId) return;
    const aksi = status === 'approved' ? 'menyetujui' : 'menolak';
    setDecidingId(id);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('setujui_absensi', { p_absensi_id: id, p_status: status });
      if (error) {
        toast(
          error.code === '42501'
            ? 'Hanya Front Office atau Admin yang dapat memutuskan absensi.'
            : error.code === 'P0002'
              ? 'Absensi tidak ditemukan. Muat ulang halaman.'
              : `Gagal ${aksi} absensi. Coba lagi.`,
          'error',
        );
        return;
      }
      toast(status === 'approved' ? 'Absensi disetujui' : 'Absensi ditolak', 'success');
      setLoading(true);
      await fetchData();
    } catch (e) {
      console.error(e);
      toast(`Gagal ${aksi} absensi. Coba lagi.`, 'error');
    } finally {
      setDecidingId(null);
    }
  };

  const hadirHariIni = absensi.filter(a => a.status === 'approved' || a.status === 'pending').length;
  const sudahPulang = absensi.filter(a => a.jam_pulang).length;
  const myTodayAbsensi = absensi.find(a => a.petugas_id === currentUser?.id);
  // 'alpa' (ditandai otomatis) bukan kehadiran: petugas boleh mengajukan lagi (jadi 'pending', perlu disetujui FO/Admin).
  const myAlpa = myTodayAbsensi?.status === 'alpa';
  const myHadir = !!myTodayAbsensi && !myAlpa;

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
        {/* Tombol Catat Hadir — Front Office / Admin (via wizard) */}
        {(currentUser?.role === 'front_office' || currentUser?.role === 'admin') && filterTanggal === todayWIB() && (
          <div style={{ background: 'var(--surface-elevated)', padding: 'var(--space-6)', borderRadius: 'var(--radius-xl)', marginBottom: 'var(--space-8)', border: '1px solid var(--border-default)' }}>
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>Catat Hadir Petugas</h3>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
              Pilih layanan, ambil foto, lalu konfirmasi nama petugas yang hadir.
            </p>
            <button className="btn btn--primary" onClick={() => setFoWizardOpen(true)}>
              <LogIn size={18} /> Catat Hadir
            </button>
          </div>
        )}

        {/* Tombol Absen Mandiri (Khusus Petugas) */}
        {currentUser?.role === 'petugas' && filterTanggal === todayWIB() && (
          <div style={{ background: 'var(--surface-elevated)', padding: 'var(--space-6)', borderRadius: 'var(--radius-xl)', marginBottom: 'var(--space-8)', border: '1px solid var(--border-default)' }}>
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, marginBottom: 'var(--space-4)' }}>Absensi Mandiri Hari Ini</h3>
            <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
              {!myHadir ? (
                <button className="btn btn--primary" onClick={handleAbsenHadir} disabled={actionLoading} aria-busy={actionLoading}>
                  <LogIn size={18} /> {actionLoading ? 'Memproses...' : myAlpa ? 'Ajukan Kehadiran' : 'Absen Hadir'}
                </button>
              ) : (
                <button className="btn btn--secondary" disabled>
                  <CheckCircle2 size={18} style={{ color: 'var(--color-success-500)' }}/> Sudah Hadir
                </button>
              )}

              {myHadir && !myTodayAbsensi.jam_pulang ? (
                 <button className="btn btn--secondary" onClick={handleAbsenPulang} disabled={actionLoading} aria-busy={actionLoading}>
                   <LogOutIcon size={18} /> Absen Pulang
                 </button>
              ) : myTodayAbsensi?.jam_pulang ? (
                 <button className="btn btn--secondary" disabled>
                   <CheckCircle2 size={18} style={{ color: 'var(--text-tertiary)' }}/> Sudah Pulang
                 </button>
              ) : null}
            </div>

            {myAlpa && (
              <p role="status" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-warning-600)', marginTop: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <Clock size={14} /> Anda tercatat Alpa hari ini. Anda masih dapat mengajukan kehadiran, tetapi harus disetujui Front Office/Admin terlebih dahulu.
              </p>
            )}
            {myTodayAbsensi && myTodayAbsensi.status === 'pending' && (
              <p role="status" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-warning-600)', marginTop: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <Clock size={14} /> Absensi Anda sedang menunggu persetujuan Front Office/Admin.
              </p>
            )}
            {myTodayAbsensi && myTodayAbsensi.status === 'ditolak' && (
              <p role="status" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-danger-600)', marginTop: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <XCircle size={14} /> Absensi Anda ditolak. Hubungi Front Office/Admin.
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
                     <td colSpan={(currentUser?.role === 'admin' || currentUser?.role === 'front_office') ? 6 : 5} style={{ padding: 'var(--space-3) var(--space-4)' }}>
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
                  {(currentUser?.role === 'admin' || currentUser?.role === 'front_office') && <th>Aksi</th>}
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
                      ) : a.status === 'alpa' ? (
                        <span className="badge badge--nonaktif" style={{ background: 'var(--color-danger-100, #fee2e2)', color: 'var(--color-danger-700, #b91c1c)' }}>Alpa</span>
                      ) : (
                        <span className="badge badge--eskalasi">Menunggu</span>
                      )}
                    </td>
                    {(currentUser?.role === 'admin' || currentUser?.role === 'front_office') && (
                      <td>
                        {a.status === 'pending' && (
                          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                            <button
                              className="btn btn--secondary btn--sm"
                              onClick={() => handleDecision(a.id, 'approved')}
                              disabled={decidingId !== null}
                              aria-busy={decidingId === a.id}
                            >
                              Setujui
                            </button>
                            <button
                              className="btn btn--danger btn--sm"
                              onClick={() => handleDecision(a.id, 'ditolak')}
                              disabled={decidingId !== null}
                              aria-busy={decidingId === a.id}
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
                    <td colSpan={(currentUser?.role === 'admin' || currentUser?.role === 'front_office') ? 6 : 5}>
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

      {/* Wizard hadir FO */}
      {currentUser && (currentUser.role === 'front_office' || currentUser.role === 'admin') && (
        <AbsensiWizardModal
          isOpen={foWizardOpen}
          foId={currentUser.id}
          onClose={() => setFoWizardOpen(false)}
          onSuccess={() => {
            setFoWizardOpen(false);
            setLoading(true);
            void fetchData();
          }}
        />
      )}
    </>
  );
}
