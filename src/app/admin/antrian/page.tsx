'use client';

import { useState, useEffect } from 'react';
import {
  Calendar,
  Clock,
  Users,
  TrendingUp,
  CheckCircle2,
  Play,
  Loader2
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';

interface PetugasData {
  id: string;
  role: string;
  layanan_id: string;
  layanan?: { nama: string };
}

interface VisitRow {
  id: string;
  nama: string;
  keperluan: string;
  status: 'menunggu' | 'dilayani' | 'selesai' | 'terjadwal' | 'batal';
  asal: 'walk_in' | 'reservasi';
  waktu_masuk: string;
  waktu_selesai: string | null;
  waktu_mulai_layan: string | null;
  layanan: { nama: string };
}

export default function AntrianPage() {
  const { toast } = useToast();
  const [tanggal, setTanggal] = useState(new Date().toISOString().split('T')[0]);
  const [antrian, setAntrian] = useState<VisitRow[]>([]);
  const [currentUser, setCurrentUser] = useState<PetugasData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tanggal]);

  async function fetchData() {
    try {
      setLoading(true);
      const supabase = createClient();
      
      const { data: { user } } = await supabase.auth.getUser();
      let myRole = 'admin';
      let myLayananId = null;

      if (user) {
        const { data: p } = await supabase
          .from('petugas')
          .select('id, role, layanan_id, layanan:layanan_id(nama)')
          .eq('auth_user_id', user.id)
          .single();
        if (p) {
          myRole = p.role;
          myLayananId = p.layanan_id;
          setCurrentUser(p as unknown as PetugasData);
        }
      }

      // Gunakan waktu lokal, lalu convert ke UTC ISO untuk query ke Supabase
      const startOfDay = new Date(`${tanggal}T00:00:00`);
      const endOfDay = new Date(`${tanggal}T23:59:59.999`);

      // Operational queue: both walk_in and scanned reservations (reservasi)
      let query = supabase
        .from('visit')
        .select('id, nama, keperluan, status, asal, waktu_masuk, waktu_selesai, waktu_mulai_layan, layanan:layanan_id(nama)')
        .in('asal', ['walk_in', 'reservasi'])
        .gte('waktu_masuk', startOfDay.toISOString())
        .lte('waktu_masuk', endOfDay.toISOString())
        .order('waktu_masuk', { ascending: true });

      if (myRole === 'petugas' && myLayananId) {
        query = query.eq('layanan_id', myLayananId);
      }

      const { data } = await query;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setAntrian((data || []) as any);
    } catch (e) {
      console.error(e);
      toast('Gagal memuat data antrian', 'error');
    } finally {
      setLoading(false);
    }
  }

  const handleMulaiLayanan = async (id: string) => {
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('visit')
        .update({
          status: 'dilayani',
          waktu_mulai_layan: new Date().toISOString(),
        })
        .eq('id', id);
      
      if (error) {
        console.error('Gagal memulai layanan:', error);
        toast('Gagal memulai layanan', 'error');
      } else {
        toast('Layanan dimulai', 'success');
        await fetchData();
      }
    } catch (e) {
      console.error(e);
      toast('Gagal memulai layanan', 'error');
    }
  };

  const handleSelesaikan = async (id: string) => {
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('visit')
        .update({
          status: 'selesai',
          waktu_selesai: new Date().toISOString()
        })
        .eq('id', id);
      
      if (error) {
        console.error("Gagal menyelesaikan antrian:", error);
        toast('Gagal menyelesaikan antrian', 'error');
      } else {
        toast('Kunjungan berhasil diselesaikan', 'success');
        await fetchData();
      }
    } catch (e) {
      console.error(e);
      toast('Gagal menyelesaikan antrian', 'error');
    }
  };

  const selesai = antrian.filter(a => a.status === 'selesai');
  
  // Hitung rata-rata durasi (dalam menit)
  const rataWaktu = selesai.length > 0
    ? Math.round(selesai.reduce((sum, a) => {
        if (!a.waktu_selesai) return sum;
        const start = a.waktu_mulai_layan
          ? new Date(a.waktu_mulai_layan).getTime()
          : new Date(a.waktu_masuk).getTime();
        const kluar = new Date(a.waktu_selesai).getTime();
        return sum + ((kluar - start) / 60000);
      }, 0) / selesai.length)
    : 0;

  const headerTitle = currentUser?.role === 'petugas' && currentUser.layanan?.nama 
    ? `Log Antrian ${Array.isArray(currentUser.layanan) ? currentUser.layanan[0]?.nama : currentUser.layanan.nama}`
    : "Log Antrian Semua Layanan";

  const statusLabel = (status: string) => {
    switch (status) {
      case 'menunggu': return '● Menunggu';
      case 'dilayani': return '▶ Dilayani';
      case 'selesai': return '✓ Selesai';
      default: return status;
    }
  };

  const asalLabel = (asal: string) => (asal === 'reservasi' ? 'Reservasi' : 'Walk-in');

  return (
    <>
      <PageHeader
        title={headerTitle}
        description="Urutan kedatangan harian — walk-in dan reservasi (setelah scan)"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <Calendar size={16} style={{ color: 'var(--text-tertiary)' }} />
          <input
            type="date"
            className="form-input"
            value={tanggal}
            onChange={(e) => setTanggal(e.target.value)}
            style={{ width: '160px', padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)' }}
          />
        </div>
      </PageHeader>

      <div style={{ padding: 'var(--space-8)' }}>
        {/* Stats */}
        <div className="grid-stats" style={{ marginBottom: 'var(--space-8)' }}>
          <div className="stat-card">
            <div className="stat-card__icon" style={{ background: 'var(--color-primary-50)', color: 'var(--color-primary-600)' }}>
              <Users size={22} />
            </div>
            <span className="stat-card__value">{antrian.length}</span>
            <span className="stat-card__label">Total Hari Ini</span>
          </div>
          <div className="stat-card">
            <div className="stat-card__icon" style={{ background: 'var(--color-success-50)', color: 'var(--color-success-600)' }}>
              <TrendingUp size={22} />
            </div>
            <span className="stat-card__value">{selesai.length}</span>
            <span className="stat-card__label">Selesai Dilayani</span>
          </div>
          <div className="stat-card">
            <div className="stat-card__icon" style={{ background: 'var(--color-accent-50)', color: 'var(--color-accent-600)' }}>
              <Clock size={22} />
            </div>
            <span className="stat-card__value">{rataWaktu} <small style={{ fontSize: '0.4em', fontWeight: 400 }}>mnt</small></span>
            <span className="stat-card__label">Rata-rata Durasi</span>
          </div>
        </div>

        {/* Table */}
        <div className="table-wrapper">
          {loading ? (
             <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-tertiary)' }}>
               <Loader2 size={24} className="animate-pulse" style={{ margin: '0 auto' }} />
               <p style={{ marginTop: 'var(--space-2)' }}>Memuat antrian...</p>
             </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>No. Urut</th>
                  {currentUser?.role === 'admin' && <th>Layanan</th>}
                  <th>Nama</th>
                  <th>Asal</th>
                  <th>Keperluan</th>
                  <th>Waktu Masuk</th>
                  <th>Status</th>
                  <th>Aksi / Durasi</th>
                </tr>
              </thead>
              <tbody>
                {antrian.map((a, idx) => {
                  let durasi = '—';
                  if (a.waktu_selesai) {
                    const start = a.waktu_mulai_layan
                      ? new Date(a.waktu_mulai_layan).getTime()
                      : new Date(a.waktu_masuk).getTime();
                    const diff = Math.round((new Date(a.waktu_selesai).getTime() - start) / 60000);
                    durasi = `${diff} menit`;
                  }
                  
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const layananNama = a.layanan ? (Array.isArray(a.layanan) ? a.layanan[0]?.nama : (a.layanan as any).nama) : '—';

                  return (
                    <tr key={a.id}>
                      <td>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '32px',
                          height: '32px',
                          borderRadius: 'var(--radius-md)',
                          background: 'var(--color-primary-50)',
                          color: 'var(--color-primary-700)',
                          fontWeight: 700,
                          fontSize: 'var(--text-sm)',
                        }}>
                          {idx + 1}
                        </span>
                      </td>
                      {currentUser?.role === 'admin' && <td style={{ fontWeight: 600 }}>{layananNama}</td>}
                      <td style={{ fontWeight: 600 }}>{a.nama}</td>
                      <td>
                        <span className={`badge badge--${a.asal === 'reservasi' ? 'pending' : 'draft'}`}>
                          {asalLabel(a.asal)}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>{a.keperluan}</td>
                      <td>{new Date(a.waktu_masuk).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</td>
                      <td>
                        <span className={`badge badge--${a.status}`}>
                          {statusLabel(a.status)}
                        </span>
                      </td>
                      <td>
                        {a.status === 'menunggu' ? (
                          <button 
                            className="btn btn--primary btn--sm"
                            onClick={() => handleMulaiLayanan(a.id)}
                            style={{ padding: '4px 12px', fontSize: '12px' }}
                          >
                            <Play size={14} style={{ marginRight: '4px' }} />
                            Mulai Layanan
                          </button>
                        ) : a.status === 'dilayani' ? (
                          <button 
                            className="btn btn--secondary btn--sm"
                            onClick={() => handleSelesaikan(a.id)}
                            style={{ padding: '4px 12px', fontSize: '12px' }}
                          >
                            <CheckCircle2 size={14} style={{ marginRight: '4px', color: 'var(--color-success-600)' }} />
                            Selesai
                          </button>
                        ) : (
                          <span style={{ color: 'var(--text-secondary)' }}>{durasi}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {antrian.length === 0 && (
                  <tr>
                    <td colSpan={currentUser?.role === 'admin' ? 8 : 7}>
                      <div className="empty-state" style={{ padding: 'var(--space-8)' }}>
                        <Users size={40} className="empty-state__icon" />
                        <h3 className="empty-state__title">Belum Ada Antrian</h3>
                        <p>Belum ada pengunjung walk-in atau reservasi untuk tanggal ini.</p>
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
