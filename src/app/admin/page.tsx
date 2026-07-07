'use client';

import {
  Users,
  Clock,
  CheckCircle2,
  TrendingUp,
  ArrowRight,
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

const recentVisits = [
  { nama: 'Ahmad Surya', layanan: 'Helpdesk OSS', waktu: '10:30', status: 'menunggu' },
  { nama: 'Siti Rahayu', layanan: 'Sertifikasi Halal', waktu: '10:15', status: 'selesai' },
  { nama: 'Budi Santoso', layanan: 'CS BPJS Kesehatan', waktu: '09:50', status: 'selesai' },
  { nama: 'Dewi Lestari', layanan: 'Helpdesk OSS', waktu: '09:30', status: 'selesai' },
  { nama: 'Rizky Pratama', layanan: 'Helpdesk OSS', waktu: '09:15', status: 'menunggu' },
];

export default function AdminDashboard() {
  const totalHariIni = 75;
  const menunggu = 3;
  const selesai = 72;
  const rataWaktu = 12;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Ringkasan data kunjungan dan layanan hari ini"
      />

      <div className={styles.dashboard} style={{ padding: 'var(--space-8)' }}>
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
