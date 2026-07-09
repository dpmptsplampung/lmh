'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Users,
  Clock,
  CheckCircle2,
  TrendingUp,
  ArrowRight,
  UserPlus,
  ChevronLeft,
  ChevronRight,
  Send,
  Building2,
  Loader2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';
import styles from './dashboard.module.css';

const CHART_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef444', '#3b82f6', '#8b5cf6', '#ec489', '#14b8a6', '#f97316'];

interface RecentVisit {
  id: string;
  nama: string;
  layanan: string;
  waktu: string;
  status: string;
}

interface DailyVisit {
  hari: string;
  kunjungan: number;
}

interface LayananBreakdown {
  nama: string;
  jumlah: number;
  color: string;
}

interface LayananRef {
  nama: string | null;
}

interface RecentVisitRow {
  id: string;
  nama: string;
  status: string;
  waktu_masuk: string;
  layanan: LayananRef | LayananRef[] | null;
}

interface WeeklyVisitRow {
  waktu_masuk: string;
}

interface BreakdownRow {
  layanan: LayananRef | LayananRef[] | null;
}

interface CompletedVisitRow {
  waktu_masuk: string;
  waktu_selesai: string | null;
}

function resolveLayananName(layanan: LayananRef | LayananRef[] | null): string {
  if (!layanan) return '—';
  if (Array.isArray(layanan)) return layanan[0]?.nama ?? '—';
  return layanan.nama ?? '—';
}

export default function AdminDashboard() {
  const { toast } = useToast();
  const [totalHariIni, setTotalHariIni] = useState(0);
  const [menunggu, setMenunggu] = useState(0);
  const [selesai, setSelesai] = useState(0);
  const [rataWaktu, setRataWaktu] = useState(0);
  const [recentVisits, setRecentVisits] = useState<RecentVisit[]>([]);
  const [dailyVisitsState, setDailyVisitsState] = useState<DailyVisit[]>([]);
  const [layananBreakdownState, setLayananBreakdownState] = useState<LayananBreakdown[]>([]);
  const [loading, setLoading] = useState(true);

  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [visitorName, setVisitorName] = useState('');
  const [visitorAsal, setVisitorAsal] = useState('');
  const [visitorKeperluan, setVisitorKeperluan] = useState('');
  const [selectedLayananId, setSelectedLayananId] = useState('');
  const [layananList, setLayananList] = useState<{ id: string; nama: string }[]>([]);
  const [savingWizard, setSavingWizard] = useState(false);
  const [wizardSuccess, setWizardSuccess] = useState(false);
  const [wizardError, setWizardError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const today = new Date().toISOString().split('T')[0];
      const startOfToday = `${today}T00:00:00`;

      const { count: total } = await supabase
        .from('kunjungan')
        .select('*', { count: 'exact', head: true })
        .gte('waktu_masuk', startOfToday);

      const { count: waiting } = await supabase
        .from('kunjungan')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'menunggu')
        .gte('waktu_masuk', startOfToday);

      const { count: done } = await supabase
        .from('kunjungan')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'selesai')
        .gte('waktu_masuk', startOfToday);

      setTotalHariIni(total ?? 0);
      setMenunggu(waiting ?? 0);
      setSelesai(done ?? 0);

      const { data: completed } = await supabase
        .from('kunjungan')
        .select('waktu_masuk, waktu_selesai')
        .eq('status', 'selesai')
        .gte('waktu_masuk', startOfToday);

      const completedRecords: CompletedVisitRow[] = (completed ?? []) as CompletedVisitRow[];
      const completedWithEnd = completedRecords.filter((r) => r.waktu_selesai);
      if (completedWithEnd.length > 0) {
        const avgMs = completedWithEnd.reduce((sum, r) => {
          return sum + (new Date(r.waktu_selesai as string).getTime() - new Date(r.waktu_masuk).getTime());
        }, 0) / completedWithEnd.length;
        setRataWaktu(Math.round(avgMs / 60000));
      } else {
        setRataWaktu(0);
      }

      const { data: recent } = await supabase
        .from('kunjungan')
        .select('id, nama, status, waktu_masuk, layanan:layanan_id(nama)')
        .order('waktu_masuk', { ascending: false })
        .limit(5);

      const recentRows: RecentVisitRow[] = (recent ?? []) as RecentVisitRow[];
      setRecentVisits(recentRows.map((r) => ({
        id: r.id,
        nama: r.nama,
        layanan: resolveLayananName(r.layanan),
        waktu: new Date(r.waktu_masuk).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
        status: r.status,
      })));

      const { data: layananData, error: layananError } = await supabase
        .from('layanan')
        .select('id, nama')
        .order('nama');
      if (layananError || !layananData || layananData.length === 0) {
        setLayananList([]);
      } else {
        setLayananList(layananData);
      }

      const days = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
      const { data: weekly } = await supabase
        .from('kunjungan')
        .select('waktu_masuk')
        .gte('waktu_masuk', sevenDaysAgo.toISOString());

      const counts: Record<string, number> = {};
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().split('T')[0];
        counts[key] = 0;
      }
      const weeklyRows: WeeklyVisitRow[] = (weekly ?? []) as WeeklyVisitRow[];
      weeklyRows.forEach((w) => {
        const key = w.waktu_masuk.split('T')[0];
        if (counts[key] !== undefined) counts[key]++;
      });
      const dailyArr: DailyVisit[] = Object.entries(counts).map(([dateStr, kunjungan]) => ({
        hari: days[new Date(dateStr).getDay()],
        kunjungan,
      }));
      setDailyVisitsState(dailyArr);

      const { data: breakdown } = await supabase
        .from('kunjungan')
        .select('layanan:layanan_id(nama)')
        .gte('waktu_masuk', startOfToday);

      const counts2: Record<string, number> = {};
      const breakdownRows: BreakdownRow[] = (breakdown ?? []) as BreakdownRow[];
      breakdownRows.forEach((b) => {
        const nama = resolveLayananName(b.layanan);
        if (nama === '—') return;
        counts2[nama] = (counts2[nama] ?? 0) + 1;
      });
      const arr: LayananBreakdown[] = Object.entries(counts2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([nama, jumlah], idx) => ({ nama, jumlah, color: CHART_COLORS[idx % CHART_COLORS.length] }));
      setLayananBreakdownState(arr);
    } catch {
      toast('Gagal memuat data dashboard. Periksa koneksi Anda.', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  const handleNextStep = () => {
    if (!visitorName.trim()) {
      setWizardError('Nama pengunjung wajib diisi');
      return;
    }
    if (!visitorAsal.trim()) {
      setWizardError('Asal instansi / alamat wajib diisi');
      return;
    }
    setWizardError('');
    setWizardStep(2);
  };

  const handleLayananSelect = (id: string) => {
    setSelectedLayananId(id);
    setWizardStep(3);
  };

  const handleSubmitWalkin = async () => {
    setSavingWizard(true);
    setWizardError('');

    try {
      const supabase = createClient();
      const { error } = await supabase.from('kunjungan').insert({
        nama: visitorName.trim(),
        asal_instansi: visitorAsal.trim(),
        keperluan: visitorKeperluan.trim() || null,
        layanan_id: selectedLayananId,
        status: 'menunggu',
      });

      if (error) throw error;
      await loadData();
      setWizardSuccess(true);
    } catch {
      setWizardError('Gagal menyimpan kunjungan walk-in. Silakan coba lagi.');
    } finally {
      setSavingWizard(false);
    }
  };

  const handleCloseWizard = () => {
    setIsWizardOpen(false);
    setWizardStep(1);
    setVisitorName('');
    setVisitorAsal('');
    setVisitorKeperluan('');
    setSelectedLayananId('');
    setWizardSuccess(false);
    setWizardError('');
  };

  const getSelectedLayananName = () => {
    return layananList.find((l) => l.id === selectedLayananId)?.nama || 'Loket Layanan';
  };

  return (
    <>
      <PageHeader
        title="Dashboard Utama"
        description="Ringkasan data kunjungan dan layanan hari ini"
      />

      <div className={styles.dashboard} style={{ padding: 'var(--space-8)' }}>

        <div className={styles.walkinTriggerContainer}>
          <button
            type="button"
            className={styles.walkinTriggerBtn}
            onClick={() => setIsWizardOpen(true)}
          >
            <UserPlus size={20} />
            + Registrasi Kunjungan Walk-in (Cepat)
          </button>
        </div>

        {isWizardOpen && (
          <div className={styles.modalOverlay}>
            <div className={styles.wizardCard}>
              <div className={styles.wizardHeader}>
                <div className={`${styles.statIcon} ${styles.statIconBlue}`} style={{ width: 36, height: 36 }}>
                  <UserPlus size={18} />
                </div>
                <span className={styles.wizardTitle}>Registrasi Walk-in</span>

                {!wizardSuccess && (
                  <button
                    type="button"
                    className={styles.closeButton}
                    onClick={handleCloseWizard}
                  >
                    <X size={18} />
                  </button>
                )}
              </div>

              <div className={styles.wizardBody}>
                {wizardSuccess ? (
                  <div style={{ textAlign: 'center', padding: 'var(--space-4)' }}>
                    <div style={{
                      width: 56, height: 56, borderRadius: '50%', background: 'var(--color-success-50)',
                      color: 'var(--color-success-600)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      margin: '0 auto var(--space-4)'
                    }}>
                      <CheckCircle2 size={28} />
                    </div>
                    <h3 style={{ fontWeight: 700, marginBottom: 'var(--space-2)' }}>Registrasi Kunjungan Berhasil!</h3>
                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-5)', lineHeight: 1.6 }}>
                      Terima kasih <strong>Bapak/Ibu {visitorName}</strong> dari <strong>{visitorAsal}</strong>. <br />
                      Pendaftaran Anda ke loket <strong>{getSelectedLayananName()}</strong> telah berhasil dicatat. <br />
                      Mohon menunggu di ruang tunggu, Anda akan segera dilayani oleh petugas kami.
                    </p>
                    <button
                      className="btn btn--primary btn--lg"
                      onClick={handleCloseWizard}
                      style={{ width: '100%' }}
                    >
                      Tutup & Selesai
                    </button>
                  </div>
                ) : (
                  <>
                    <div className={styles.wizardSteps}>
                      <div className={`${styles.wizardStep} ${wizardStep >= 1 ? (wizardStep > 1 ? styles.wizardStepDone : styles.wizardStepActive) : ''}`}>
                        {wizardStep > 1 ? '✓' : '1'}
                      </div>
                      <div className={`${styles.wizardStep} ${wizardStep >= 2 ? (wizardStep > 2 ? styles.wizardStepDone : styles.wizardStepActive) : ''}`}>
                        {wizardStep > 2 ? '✓' : '2'}
                      </div>
                      <div className={`${styles.wizardStep} ${wizardStep >= 3 ? styles.wizardStepActive : ''}`}>
                        3
                      </div>
                    </div>

                    {wizardStep === 1 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                        <div className="form-group">
                          <label className="form-label form-label--required" htmlFor="walkinName">Nama Lengkap</label>
                          <input
                            id="walkinName"
                            type="text"
                            className="form-input"
                            placeholder="Contoh: Budi Santoso"
                            value={visitorName}
                            onChange={(e) => setVisitorName(e.target.value)}
                            autoComplete="off"
                            required
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label form-label--required" htmlFor="walkinAsal">Asal Instansi / Alamat</label>
                          <input
                            id="walkinAsal"
                            type="text"
                            className="form-input"
                            placeholder="Contoh: PT Lampung Berjaya / Kedaton"
                            value={visitorAsal}
                            onChange={(e) => setVisitorAsal(e.target.value)}
                            autoComplete="off"
                            required
                          />
                        </div>
                        {wizardError && <p className="form-error">{wizardError}</p>}
                        <div className={styles.wizardActions}>
                          <button className="btn btn--primary" onClick={handleNextStep}>
                            Lanjut Pilih Layanan
                            <ChevronRight size={16} />
                          </button>
                        </div>
                      </div>
                    )}

                    {wizardStep === 2 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                          Halo <strong>Bapak/Ibu {visitorName}</strong> dari <strong>{visitorAsal}</strong>, <br />
                          layanan apa yang ingin Anda akses hari ini?
                        </p>

                        {layananList.length === 0 ? (
                          <p className="form-error">Gagal memuat daftar layanan</p>
                        ) : (
                          <div className={styles.wizardLayananGrid}>
                            {layananList.map((layanan) => (
                              <button
                                type="button"
                                key={layanan.id}
                                className={`${styles.wizardLayananButton} ${selectedLayananId === layanan.id ? styles.wizardLayananButtonActive : ''}`}
                                onClick={() => handleLayananSelect(layanan.id)}
                              >
                                <Building2 size={24} style={{ color: 'var(--color-primary-500)' }} />
                                <div style={{ fontSize: 'var(--text-sm)' }}>{layanan.nama}</div>
                              </button>
                            ))}
                          </div>
                        )}

                        <div className="form-group" style={{ marginTop: 'var(--space-2)' }}>
                          <label className="form-label" htmlFor="walkinReason">Keperluan</label>
                          <input
                            id="walkinReason"
                            type="text"
                            className="form-input"
                            placeholder="Detail keperluan singkat (opsional)..."
                            value={visitorKeperluan}
                            onChange={(e) => setVisitorKeperluan(e.target.value)}
                            autoComplete="off"
                          />
                        </div>

                        <div className={styles.wizardActions}>
                          <button className="btn btn--secondary" onClick={() => setWizardStep(1)}>
                            <ChevronLeft size={16} />
                            Kembali
                          </button>
                        </div>
                      </div>
                    )}

                    {wizardStep === 3 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                          Apakah data kunjungan <strong>Bapak/Ibu {visitorName}</strong> sudah benar?
                        </p>

                        <div className={styles.wizardConfirmGrid}>
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>NAMA PENGUNJUNG</div>
                          <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Bapak/Ibu {visitorName}</div>

                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '4px' }}>ASAL / INSTANSI</div>
                          <div style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{visitorAsal}</div>

                          {visitorKeperluan.trim() && (
                            <>
                              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '4px' }}>KEPERLUAN</div>
                              <div style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{visitorKeperluan}</div>
                            </>
                          )}

                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '4px' }}>LOKET TUJUAN</div>
                          <div style={{ fontWeight: 700, color: 'var(--color-primary-700)' }}>{getSelectedLayananName()}</div>
                        </div>

                        {wizardError && <p className="form-error">{wizardError}</p>}

                        <div className={styles.wizardActions}>
                          <button className="btn btn--secondary" onClick={() => setWizardStep(2)} disabled={savingWizard}>
                            <ChevronLeft size={16} />
                            Kembali
                          </button>
                          <button
                            className="btn btn--primary"
                            onClick={handleSubmitWalkin}
                            disabled={savingWizard || layananList.length === 0}
                          >
                            {savingWizard ? (
                              <><Loader2 size={16} className="animate-pulse" /> Mendaftarkan...</>
                            ) : (
                              <><Send size={16} /> Konfirmasi & Daftarkan</>
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 'var(--space-16)' }}>
            <div className="spinner" />
          </div>
        ) : (
          <>
            <div className={styles.statsGrid}>
              <div className={styles.statCard}>
                <div className={`${styles.statIcon} ${styles.statIconBlue}`}>
                  <Users size={24} />
                </div>
                <div className={styles.statInfo}>
                  <span className={styles.statValue}>{totalHariIni}</span>
                  <span className={styles.statLabel}>Kunjungan Hari Ini</span>
                </div>
              </div>

              <div className={styles.statCard}>
                <div className={`${styles.statIcon} ${styles.statIconAmber}`}>
                  <Clock size={24} />
                </div>
                <div className={styles.statInfo}>
                  <span className={styles.statValue}>{menunggu}</span>
                  <span className={styles.statLabel}>Sedang Menunggu</span>
                </div>
              </div>

              <div className={styles.statCard}>
                <div className={`${styles.statIcon} ${styles.statIconGreen}`}>
                  <CheckCircle2 size={24} />
                </div>
                <div className={styles.statInfo}>
                  <span className={styles.statValue}>{selesai}</span>
                  <span className={styles.statLabel}>Selesai Dilayani</span>
                </div>
              </div>

              <div className={styles.statCard}>
                <div className={`${styles.statIcon} ${styles.statIconRed}`}>
                  <TrendingUp size={24} />
                </div>
                <div className={styles.statInfo}>
                  <span className={styles.statValue}>{rataWaktu} <small style={{ fontSize: '0.5em', fontWeight: 400 }}>mnt</small></span>
                  <span className={styles.statLabel}>Rata-rata Waktu Tunggu</span>
                </div>
              </div>
            </div>

            <div className={styles.chartsGrid}>
              <div className={styles.chartCard}>
                <h3 className={styles.chartTitle}>Volume Kunjungan Mingguan</h3>
                <div className={styles.chartBody}>
                  {dailyVisitsState.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dailyVisitsState}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="hari" fontSize={12} tickLine={false} />
                        <YAxis fontSize={12} tickLine={false} axisLine={false} />
                        <Tooltip
                          contentStyle={{
                            borderRadius: '8px',
                            border: '1px solid #e2e8f0',
                            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                          }}
                        />
                        <Bar
                          dataKey="kunjungan"
                          fill="#6366f1"
                          radius={[6, 6, 0, 0]}
                          name="Kunjungan"
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>Belum ada data mingguan</span>
                  )}
                </div>
              </div>

              <div className={styles.chartCard}>
                <h3 className={styles.chartTitle}>Breakdown per Layanan</h3>
                <div className={styles.chartBody}>
                  {layananBreakdownState.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={layananBreakdownState}
                          dataKey="jumlah"
                          nameKey="nama"
                          cx="50%"
                          cy="50%"
                          outerRadius={90}
                          innerRadius={50}
                          paddingAngle={4}
                        >
                          {layananBreakdownState.map((entry) => (
                            <Cell key={entry.nama} fill={entry.color} />
                          ))}
                        </Pie>
                        <Legend
                          verticalAlign="bottom"
                          iconType="circle"
                          iconSize={8}
                          wrapperStyle={{ fontSize: '12px' }}
                        />
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>Belum ada data layanan</span>
                  )}
                </div>
              </div>
            </div>

            <div className={styles.recentSection}>
              <div className={styles.recentHeader}>
                <h3 className={styles.recentTitle}>Kunjungan Terbaru</h3>
                <Link href="/admin/kunjungan" className="btn btn--ghost btn--sm">
                  Lihat Semua <ArrowRight size={14} />
                </Link>
              </div>
              <div className="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Nama</th>
                      <th>Layanan</th>
                      <th>Waktu</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentVisits.length > 0 ? (
                      recentVisits.map((visit, i) => (
                        <tr key={i}>
                          <td style={{ fontWeight: 500 }}>{visit.nama}</td>
                          <td>{visit.layanan}</td>
                          <td>{visit.waktu}</td>
                          <td>
                            <span className={`badge badge--${visit.status}`}>
                              {visit.status === 'menunggu' ? '● Menunggu' : '✓ Selesai'}
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 'var(--space-6)' }}>
                          Belum ada kunjungan hari ini
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
