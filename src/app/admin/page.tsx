'use client';

import { useEffect, useState } from 'react';
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
import { LAYANAN_LIST } from '@/lib/constants';
import styles from './dashboard.module.css';

// Demo data — akan diganti dengan data dari Supabase
const dailyVisits = [
  { hari: 'Sen', kunjungan: 12 },
  { hari: 'Sel', kunjungan: 18 },
  { hari: 'Rab', kunjungan: 15 },
  { hari: 'Kam', kunjungan: 22 },
  { hari: 'Jum', kunjungan: 8 },
  { hari: 'Sab', kunjungan: 0 },
  { hari: 'Min', kunjungan: 0 },
];

const layananBreakdown = [
  { nama: 'Helpdesk OSS', jumlah: 42, color: '#6366f1' },
  { nama: 'Sertifikasi Halal', jumlah: 18, color: '#10b981' },
  { nama: 'CS BPJS Kesehatan', jumlah: 25, color: '#f59e0b' },
];

// recentVisits will be fetched dynamically (Disabled for seed/documentation)
const SEED_VISITS = [
  { id: 'v1', nama: 'Ahmad Surya', layanan: 'Helpdesk OSS', waktu: '10:30', status: 'menunggu' },
  { id: 'v2', nama: 'Siti Rahayu', layanan: 'Sertifikasi Halal', waktu: '10:15', status: 'selesai' },
  { id: 'v3', nama: 'Budi Santoso', layanan: 'CS BPJS Kesehatan', waktu: '09:50', status: 'selesai' },
  { id: 'v4', nama: 'Dewi Lestari', layanan: 'Helpdesk OSS', waktu: '09:30', status: 'selesai' },
  { id: 'v5', nama: 'Rizky Pratama', layanan: 'Helpdesk OSS', waktu: '09:15', status: 'menunggu' },
];

export default function AdminDashboard() {
  const [totalHariIni, setTotalHariIni] = useState(75);
  const [menunggu, setMenunggu] = useState(3);
  const [selesai, setSelesai] = useState(72);
  const [rataWaktu, setRataWaktu] = useState(12);
  const [recentVisits, setRecentVisits] = useState<{ id: string; nama: string; layanan: string; waktu: string; status: string }[]>(SEED_VISITS);

  // Wizard Popup States
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [visitorName, setVisitorName] = useState('');
  const [visitorAsal, setVisitorAsal] = useState('');
  const [visitorKeperluan, setVisitorKeperluan] = useState('');
  const [selectedLayananId, setSelectedLayananId] = useState('');
  const [layananList, setLayananList] = useState<{ id: string; nama: string }[]>(LAYANAN_LIST.map((nama, i) => ({ id: `fallback-${i}`, nama })));
  const [savingWizard, setSavingWizard] = useState(false);
  const [wizardSuccess, setWizardSuccess] = useState(false);
  const [wizardError, setWizardError] = useState('');

  useEffect(() => {
    // Supabase loadData disabled for documentation seeding
  }, []);

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
        
        {/* Trigger Button Walk-in Kunjungan */}
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

        {/* Wizard Popup Modal (Backdrop Blur) */}
        {isWizardOpen && (
          <div className={styles.modalOverlay}>
            <div className={styles.wizardCard}>
              {/* Header */}
              <div className={styles.wizardHeader}>
                <div className={`${styles.statIcon} ${styles.statIconBlue}`} style={{ width: 36, height: 36 }}>
                  <UserPlus size={18} />
                </div>
                <span className={styles.wizardTitle}>Registrasi Walk-in</span>

                {/* Close Button: disembunyikan saat sukses agar wajib tekan tombol Tutup & Selesai */}
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

              {/* Body */}
              <div className={styles.wizardBody}>
                {wizardSuccess ? (
                  /* Success/Thank you Screen (Wajib tekan Tutup & Selesai) */
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
                    {/* Step Indicators */}
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
                      /* Step 1: Input Nama & Asal */
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
                      /* Step 2: Pilih Layanan (Dengan sapaan dinamis) */
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                          Halo <strong>Bapak/Ibu {visitorName}</strong> dari <strong>{visitorAsal}</strong>, <br />
                          layanan apa yang ingin Anda akses hari ini?
                        </p>

                        <div className={styles.wizardLayananGrid}>
                          {layananList.map((layanan) => (
                            <div
                              key={layanan.id}
                              className={`${styles.wizardLayananButton} ${selectedLayananId === layanan.id ? styles.wizardLayananButtonActive : ''}`}
                              onClick={() => handleLayananSelect(layanan.id)}
                            >
                              <Building2 size={24} style={{ color: 'var(--color-primary-500)' }} />
                              <div style={{ fontSize: 'var(--text-sm)' }}>{layanan.nama}</div>
                            </div>
                          ))}
                        </div>

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
                      /* Step 3: Konfirmasi */
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
                          <button className="btn btn--primary" onClick={handleSubmitWalkin} disabled={savingWizard}>
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

        {/* Stats */}
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

        {/* Charts */}
        <div className={styles.chartsGrid}>
          <div className={styles.chartCard}>
            <h3 className={styles.chartTitle}>Volume Kunjungan Mingguan</h3>
            <div className={styles.chartBody}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyVisits}>
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
            </div>
          </div>

          <div className={styles.chartCard}>
            <h3 className={styles.chartTitle}>Breakdown per Layanan</h3>
            <div className={styles.chartBody}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={layananBreakdown}
                    dataKey="jumlah"
                    nameKey="nama"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    innerRadius={50}
                    paddingAngle={4}
                  >
                    {layananBreakdown.map((entry) => (
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
            </div>
          </div>
        </div>

        {/* Recent Visits */}
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
                {recentVisits.map((visit, i) => (
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
