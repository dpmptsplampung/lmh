'use client';

// WP-22: Queue reads migrated from visit → tiket_antrean + kunjungan.
// Status updates (Mulai Layanan, Selesai) still write to visit via legacy_visit_id;
// trg_visit_dual_write propagates the change back to tiket_antrean atomically.

import { useState, useEffect } from 'react';
import { todayWIB } from '@/lib/time';
import {
  Calendar,
  Clock,
  Users,
  TrendingUp,
  CheckCircle2,
  Play,
  AlertCircle,
  Volume2,
  FileText,
  FileEdit,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Pagination from '@/components/Pagination';
import WalkinWizard from '@/components/WalkinWizard';
import PelayananWizardModal from '@/components/admin/PelayananWizardModal';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';

const PAGE_SIZE = 25;

interface PetugasData {
  id: string;
  role: string;
  layanan_id: string;
  layanan?: { nama: string } | { nama: string }[];
}

interface KunjunganEmbed {
  nama: string;
  asal: 'walk_in' | 'reservasi';
  waktu_masuk: string | null;
}

interface AntrianRow {
  id: string;             // tiket_antrean.id
  legacy_visit_id: string; // used to UPDATE visit.status
  nomor: number;
  nomor_display: string;
  status: 'menunggu' | 'dilayani' | 'selesai' | 'tidak_terlayani' | 'no_show' | 'batal';
  waktu_terbit: string | null;
  waktu_mulai_layan: string | null;
  waktu_selesai: string | null;
  layanan: { nama: string } | { nama: string }[] | null;
  kunjungan: KunjunganEmbed | KunjunganEmbed[] | null;
}

export default function AntrianPage() {
  const { toast } = useToast();
  const [tanggal, setTanggal] = useState(todayWIB());
  const [antrian, setAntrian] = useState<AntrianRow[]>([]);
  const [currentUser, setCurrentUser] = useState<PetugasData | null>(null);
  const [unassigned, setUnassigned] = useState(false);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [serverStats, setServerStats] = useState<{
    totalSelesai: number;
    rataWaktuMenit: number;
  }>({ totalSelesai: 0, rataWaktuMenit: 0 });
  const [activeWizardTiketId, setActiveWizardTiketId] = useState<string | null>(null);

  const isLayananPendataan = (layananNama: string): boolean => {
    const norm = layananNama.toLowerCase();
    return norm.includes('oss') || norm.includes('perizinan');
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tanggal, page]);

  async function fetchData() {
    try {
      setLoading(true);
      const supabase = createClient();

      const { data: { user } } = await supabase.auth.getUser();
      let myRole = 'admin';
      let myLayananId: string | null = null;

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

      // Petugas tanpa layanan tidak boleh melihat antrian
      if (myRole === 'petugas' && !myLayananId) {
        setUnassigned(true);
        setAntrian([]);
        setTotalCount(0);
        return;
      }
      setUnassigned(false);

      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      // WP-22: read from tiket_antrean filtered by tanggal (date column).
      // kunjungan embedded for nama, asal, waktu_masuk.
      // Only rows with issued tickets are included — terjadwal reservations have no ticket yet.
      let query = supabase
        .from('tiket_antrean')
        .select(`
          id, legacy_visit_id, nomor, nomor_display, status,
          waktu_terbit, waktu_mulai_layan, waktu_selesai,
          layanan:layanan_id(nama),
          kunjungan(nama, asal, waktu_masuk)
        `, { count: 'exact' })
        .eq('tanggal', tanggal)
        .order('nomor', { ascending: true });

      if (myRole === 'petugas' && myLayananId) {
        query = query.eq('layanan_id', myLayananId);
      }

      const { data, count } = await query.range(from, to);
      setAntrian((data || []) as unknown as AntrianRow[]);
      setTotalCount(count ?? (data?.length ?? 0));

      // T-5: Stats dari server, bukan dari halaman aktif saja
      let statsQuery = supabase
        .from('tiket_antrean')
        .select('waktu_mulai_layan, waktu_selesai', { count: 'exact' })
        .eq('tanggal', tanggal)
        .eq('status', 'selesai');

      if (myRole === 'petugas' && myLayananId) {
        statsQuery = statsQuery.eq('layanan_id', myLayananId);
      }

      const { data: statsData, count: selesaiCount } = await statsQuery;
      const selesaiRows = statsData ?? [];
      const totalDurasiMenit = selesaiRows.reduce((sum, row) => {
        if (!row.waktu_selesai || !row.waktu_mulai_layan) return sum;
        return sum + (new Date(row.waktu_selesai).getTime() - new Date(row.waktu_mulai_layan).getTime()) / 60000;
      }, 0);
      setServerStats({
        totalSelesai: selesaiCount ?? selesaiRows.length,
        rataWaktuMenit: selesaiRows.length > 0 ? Math.round(totalDurasiMenit / selesaiRows.length) : 0,
      });
    } catch (e) {
      console.error(e);
      toast('Gagal memuat data antrian', 'error');
    } finally {
      setLoading(false);
    }
  }

  // WP-23 QUE-17: emit nomor_dipanggil event via panggil_tiket RPC.
  const handlePanggil = async (tiketId: string, nomorDisplay: string) => {
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('panggil_tiket', { p_tiket_id: tiketId });
      if (error) {
        console.error('Gagal memanggil tiket:', error);
        toast(`Gagal memanggil ${nomorDisplay}`, 'error');
      } else {
        toast(`Memanggil ${nomorDisplay}…`, 'success');
      }
    } catch (e) {
      console.error(e);
      toast('Gagal memanggil tiket', 'error');
    }
  };

  // Status updates write to visit; trg_visit_dual_write propagates to tiket_antrean.
  const handleMulaiLayanan = async (legacyVisitId: string, tiketId: string, layananNama: string) => {
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('visit')
        .update({ status: 'dilayani', waktu_mulai_layan: new Date().toISOString() })
        .eq('id', legacyVisitId);
      if (error) {
        console.error('Gagal memulai layanan:', error);
        toast('Gagal memulai layanan', 'error');
      } else {
        toast('Layanan dimulai', 'success');
        await fetchData();
        if (isLayananPendataan(layananNama)) {
          setActiveWizardTiketId(tiketId);
        }
      }
    } catch (e) {
      console.error(e);
      toast('Gagal memulai layanan', 'error');
    }
  };

  const handleSelesaikan = async (legacyVisitId: string, tiketId?: string, layananNama?: string) => {
    if (layananNama && isLayananPendataan(layananNama) && tiketId) {
      setActiveWizardTiketId(tiketId);
      return;
    }
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('visit')
        .update({ status: 'selesai', waktu_selesai: new Date().toISOString() })
        .eq('id', legacyVisitId);
      if (error) {
        console.error('Gagal menyelesaikan antrian:', error);
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

  const resolveKunjungan = (a: AntrianRow): KunjunganEmbed | null => {
    if (!a.kunjungan) return null;
    return Array.isArray(a.kunjungan) ? a.kunjungan[0] ?? null : a.kunjungan;
  };

  const resolveLayananNama = (a: AntrianRow): string => {
    if (!a.layanan) return '—';
    if (Array.isArray(a.layanan)) return a.layanan[0]?.nama ?? '—';
    return (a.layanan as { nama: string }).nama ?? '—';
  };

  const layananNamaHeader = (() => {
    const l = currentUser?.layanan;
    if (!l) return null;
    if (Array.isArray(l)) return l[0]?.nama;
    return (l as { nama: string }).nama;
  })();

  const headerTitle = currentUser?.role === 'petugas' && layananNamaHeader
    ? `Log Antrian ${layananNamaHeader}`
    : 'Log Antrian Semua Layanan';

  const statusLabel = (status: string) => {
    switch (status) {
      case 'menunggu': return '● Menunggu';
      case 'dilayani': return '▶ Dilayani';
      case 'selesai': return '✓ Selesai';
      case 'tidak_terlayani': return '✗ Tidak Terlayani (petugas tidak hadir)';
      case 'no_show': return '○ Tidak Datang (warga)';
      case 'batal': return '⊘ Batal';
      default: return status;
    }
  };

  const asalLabel = (asal: string) => (asal === 'reservasi' ? 'Reservasi' : 'Walk-in');
  const isAdminLike = currentUser?.role === 'admin' || currentUser?.role === 'front_office';

  return (
    <>
      <PageHeader
        title={headerTitle}
        description="Urutan kedatangan harian — walk-in dan reservasi (setelah scan)"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <WalkinWizard
            fixedLayananId={currentUser?.role === 'petugas' ? currentUser.layanan_id : null}
            onSuccess={fetchData}
            triggerLabel="+ Walk-in"
            triggerClassName="btn btn--primary btn--sm"
          />
          <Calendar size={16} style={{ color: 'var(--text-tertiary)' }} />
          <input
            type="date"
            className="form-input"
            value={tanggal}
            onChange={(e) => { setTanggal(e.target.value); setPage(0); }}
            style={{ width: '160px', padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)' }}
          />
        </div>
      </PageHeader>

      <div style={{ padding: 'var(--space-8)' }}>
        {unassigned ? (
          <div className="table-wrapper">
            <div className="empty-state" style={{ padding: 'var(--space-8)' }}>
              <AlertCircle size={40} className="empty-state__icon" />
              <h3 className="empty-state__title">Belum Ditugaskan</h3>
              <p>Akun Anda belum ditugaskan ke layanan. Hubungi admin.</p>
            </div>
          </div>
        ) : (
          <>
            {/* Stats */}
            <div className="grid-stats" style={{ marginBottom: 'var(--space-8)' }}>
              <div className="stat-card">
                <div className="stat-card__icon" style={{ background: 'var(--color-primary-50)', color: 'var(--color-primary-600)' }}>
                  <Users size={22} />
                </div>
                <span className="stat-card__value">{totalCount}</span>
                <span className="stat-card__label">Total Hari Ini</span>
              </div>
              <div className="stat-card">
                <div className="stat-card__icon" style={{ background: 'var(--color-success-50)', color: 'var(--color-success-600)' }}>
                  <TrendingUp size={22} />
                </div>
                <span className="stat-card__value">{serverStats.totalSelesai}</span>
                <span className="stat-card__label">Selesai Dilayani</span>
              </div>
              <div className="stat-card">
                <div className="stat-card__icon" style={{ background: 'var(--color-accent-50)', color: 'var(--color-accent-600)' }}>
                  <Clock size={22} />
                </div>
                <span className="stat-card__value">
                  {serverStats.rataWaktuMenit} <small style={{ fontSize: '0.4em', fontWeight: 400 }}>mnt</small>
                </span>
                <span className="stat-card__label">Rata-rata Durasi</span>
              </div>
            </div>

            {/* Table */}
            <div className="table-wrapper">
              {loading ? (
                <table className="table" aria-hidden="true">
                  <tbody>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i}>
                        <td colSpan={isAdminLike ? 7 : 6} style={{ padding: 'var(--space-3) var(--space-4)' }}>
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
                      <th>No. Tiket</th>
                      {isAdminLike && <th>Layanan</th>}
                      <th>Nama</th>
                      <th>Asal</th>
                      <th>Waktu Masuk</th>
                      <th>Status</th>
                      <th>Aksi / Durasi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {antrian.map((a) => {
                      const k = resolveKunjungan(a);
                      const waktuMasuk = k?.waktu_masuk ?? a.waktu_terbit;

                      let durasi = '—';
                      if (a.waktu_selesai) {
                        const start = a.waktu_mulai_layan
                          ? new Date(a.waktu_mulai_layan).getTime()
                          : new Date(waktuMasuk || new Date().toISOString()).getTime();
                        const diff = Math.round((new Date(a.waktu_selesai).getTime() - start) / 60000);
                        durasi = `${diff} menit`;
                      }

                      return (
                        <tr key={a.id}>
                          <td>
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              minWidth: '48px',
                              padding: '2px 8px',
                              borderRadius: 'var(--radius-md)',
                              background: 'var(--color-primary-50)',
                              color: 'var(--color-primary-700)',
                              fontWeight: 700,
                              fontSize: 'var(--text-sm)',
                            }}>
                              {a.nomor_display}
                            </span>
                          </td>
                          {isAdminLike && (
                            <td style={{ fontWeight: 600 }}>{resolveLayananNama(a)}</td>
                          )}
                          <td style={{ fontWeight: 600 }}>{k?.nama ?? '—'}</td>
                          <td>
                            <span className={`badge badge--${k?.asal === 'reservasi' ? 'pending' : 'draft'}`}>
                              {asalLabel(k?.asal ?? 'walk_in')}
                            </span>
                          </td>
                          <td>
                            {waktuMasuk
                              ? new Date(waktuMasuk).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
                              : '—'}
                          </td>
                          <td>
                            <span className={`badge badge--${a.status}`}>
                              {statusLabel(a.status)}
                            </span>
                          </td>
                          <td>
                            {a.status === 'menunggu' ? (
                              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                                {/* QUE-17: panggil ulang — emit nomor_dipanggil event */}
                                <button
                                  className="btn btn--ghost btn--sm"
                                  onClick={() => handlePanggil(a.id, a.nomor_display)}
                                  title="Panggil ulang ke layar antrean"
                                  style={{ padding: '4px 10px', fontSize: '12px' }}
                                >
                                  <Volume2 size={14} style={{ marginRight: '4px' }} />
                                  Panggil
                                </button>
                                <button
                                  className="btn btn--primary btn--sm"
                                  onClick={() => handleMulaiLayanan(a.legacy_visit_id, a.id, resolveLayananNama(a))}
                                  style={{ padding: '4px 12px', fontSize: '12px' }}
                                >
                                  <Play size={14} style={{ marginRight: '4px' }} />
                                  Mulai Layanan
                                </button>
                              </div>
                            ) : a.status === 'dilayani' ? (
                              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                                {isLayananPendataan(resolveLayananNama(a)) && (
                                  <button
                                    className="btn btn--primary btn--sm"
                                    onClick={() => setActiveWizardTiketId(a.id)}
                                    style={{ padding: '4px 10px', fontSize: '12px' }}
                                  >
                                    <FileEdit size={14} style={{ marginRight: '4px' }} />
                                    Form Pendataan
                                  </button>
                                )}
                                <button
                                  className="btn btn--secondary btn--sm"
                                  onClick={() => handleSelesaikan(a.legacy_visit_id, a.id, resolveLayananNama(a))}
                                  style={{ padding: '4px 12px', fontSize: '12px' }}
                                >
                                  <CheckCircle2 size={14} style={{ marginRight: '4px', color: 'var(--color-success-600)' }} />
                                  Selesai
                                </button>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <span style={{ color: 'var(--text-secondary)' }}>{durasi}</span>
                                {isLayananPendataan(resolveLayananNama(a)) && (
                                  <button
                                    className="btn btn--ghost btn--xs"
                                    onClick={() => setActiveWizardTiketId(a.id)}
                                    style={{ fontSize: '11px', padding: '2px 6px', width: 'fit-content' }}
                                  >
                                    <FileText size={12} style={{ marginRight: '3px' }} />
                                    Lihat Data
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {antrian.length === 0 && (
                      <tr>
                        <td colSpan={isAdminLike ? 7 : 6}>
                          <div className="empty-state" style={{ padding: 'var(--space-8)' }}>
                            <Users size={40} className="empty-state__icon" />
                            <h3 className="empty-state__title">Belum Ada Antrian</h3>
                            <p>Belum ada tiket untuk tanggal ini.</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
              {!loading && (
                <Pagination page={page} pageSize={PAGE_SIZE} total={totalCount} onPageChange={setPage} />
              )}
            </div>
          </>
        )}
      </div>

      <PelayananWizardModal
        isOpen={Boolean(activeWizardTiketId)}
        tiketId={activeWizardTiketId}
        onClose={() => setActiveWizardTiketId(null)}
        onSuccess={async () => {
          await fetchData();
        }}
      />
    </>
  );
}