'use client';

// WP-22: Stats reads migrated from visit → kunjungan + tiket_antrean.
// Writes (WalkinWizard) still target visit; dual-write trigger handles propagation.

import { useEffect, useState, useCallback } from 'react';
import { todayWIB, addDaysWIB } from '@/lib/time';
import {
  Users,
  Clock,
  CheckCircle2,
  TrendingUp,
  ArrowRight,
  UserPlus,
  ShieldCheck,
  ClipboardList,
  Bot,
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
import WalkinWizard from '@/components/WalkinWizard';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';
import styles from './dashboard.module.css';

const CHART_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

interface RecentVisit {
  id: string;
  nama: string;
  layanan: string;
  waktu: string;
  status: string;
  nomor_display: string;
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

export default function AdminDashboard() {
  const { toast } = useToast();

  // Role-based redirect: FO → kunjungan, petugas → antrian
  // Admin stays on this dashboard.
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      const jwtRole = user.app_metadata?.role as string | undefined;
      if (jwtRole === 'front_office') { window.location.replace('/admin/kunjungan'); return; }
      if (jwtRole === 'petugas') { window.location.replace('/admin/antrian'); return; }
      // If role not in JWT yet, fall back to DB
      if (!jwtRole) {
        supabase.from('petugas').select('role').eq('auth_user_id', user.id).maybeSingle()
          .then(({ data }) => {
            if (data?.role === 'front_office') window.location.replace('/admin/kunjungan');
            else if (data?.role === 'petugas') window.location.replace('/admin/antrian');
          });
      }
    });
  }, []);

  const [totalHariIni, setTotalHariIni] = useState(0);
  const [menunggu, setMenunggu] = useState(0);
  const [selesai, setSelesai] = useState(0);
  const [rataWaktu, setRataWaktu] = useState(0);
  const [recentVisits, setRecentVisits] = useState<RecentVisit[]>([]);
  const [dailyVisitsState, setDailyVisitsState] = useState<DailyVisit[]>([]);
  const [layananBreakdownState, setLayananBreakdownState] = useState<LayananBreakdown[]>([]);
  const [loading, setLoading] = useState(true);
  const [layananList, setLayananList] = useState<{ id: string; nama: string }[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const today = todayWIB();

      // --- 1. Total kunjungan hari ini (all loket, checked-in) ---
      const { count: total } = await supabase
        .from('kunjungan')
        .select('*', { count: 'exact', head: true })
        .eq('tanggal', today)
        .neq('status', 'terjadwal');

      // --- 2. Sedang menunggu (via tiket_antrean) ---
      const { count: waiting } = await supabase
        .from('tiket_antrean')
        .select('*', { count: 'exact', head: true })
        .eq('tanggal', today)
        .eq('status', 'menunggu');

      // --- 3. Selesai dilayani (via tiket_antrean) ---
      const { count: done } = await supabase
        .from('tiket_antrean')
        .select('*', { count: 'exact', head: true })
        .eq('tanggal', today)
        .eq('status', 'selesai');

      setTotalHariIni(total ?? 0);
      setMenunggu(waiting ?? 0);
      setSelesai(done ?? 0);

      // --- 4. Rata-rata waktu layanan (tiket selesai hari ini) ---
      const { data: completedTickets } = await supabase
        .from('tiket_antrean')
        .select('waktu_mulai_layan, waktu_selesai')
        .eq('tanggal', today)
        .eq('status', 'selesai')
        .not('waktu_selesai', 'is', null);

      const completedWithBoth = (completedTickets ?? []).filter(
        (t) => t.waktu_mulai_layan && t.waktu_selesai
      );
      if (completedWithBoth.length > 0) {
        const avgMs = completedWithBoth.reduce((sum, t) => {
          return sum + (
            new Date(t.waktu_selesai as string).getTime() -
            new Date(t.waktu_mulai_layan as string).getTime()
          );
        }, 0) / completedWithBoth.length;
        setRataWaktu(Math.round(avgMs / 60000));
      } else {
        setRataWaktu(0);
      }

      // --- 5. Kunjungan terbaru (last 5 hari ini) ---
      const { data: recent } = await supabase
        .from('kunjungan')
        .select('id, nama, status, waktu_masuk, tiket_antrean(nomor_display, layanan:layanan_id(nama))')
        .eq('tanggal', today)
        .neq('status', 'terjadwal')
        .order('waktu_masuk', { ascending: false, nullsFirst: false })
        .limit(5);

      setRecentVisits((recent ?? []).map((r) => {
        const tiket = Array.isArray(r.tiket_antrean) ? r.tiket_antrean[0] : r.tiket_antrean;
        const layananObj = tiket?.layanan;
        const layananNama = !layananObj
          ? '—'
          : Array.isArray(layananObj)
            ? (layananObj[0]?.nama ?? '—')
            : ((layananObj as { nama: string }).nama ?? '—');
        return {
          id: r.id,
          nama: r.nama,
          layanan: layananNama,
          nomor_display: tiket?.nomor_display ?? '—',
          waktu: r.waktu_masuk
            ? new Date(r.waktu_masuk).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
            : '—',
          status: r.status,
        };
      }));

      // --- 6. Layanan list untuk WalkinWizard ---
      const { data: layananData } = await supabase
        .from('layanan')
        .select('id, nama')
        .order('nama');
      setLayananList(layananData ?? []);

      // --- 7. Volume kunjungan mingguan (last 7 days via kunjungan.tanggal) ---
      const days = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
      const sevenDaysAgo = addDaysWIB(-6);
      const { data: weekly } = await supabase
        .from('kunjungan')
        .select('tanggal')
        .gte('tanggal', sevenDaysAgo)
        .lte('tanggal', today)
        .neq('status', 'terjadwal');

      const counts: Record<string, number> = {};
      for (let i = 6; i >= 0; i--) {
        counts[addDaysWIB(-i)] = 0;
      }
      (weekly ?? []).forEach((w) => {
        if (counts[w.tanggal] !== undefined) counts[w.tanggal]++;
      });
      setDailyVisitsState(
        Object.entries(counts).map(([dateStr, kunjungan]) => ({
          hari: days[new Date(dateStr + 'T12:00:00').getDay()],
          kunjungan,
        }))
      );

      // --- 8. Breakdown per layanan hari ini (via tiket_antrean) ---
      const { data: breakdown } = await supabase
        .from('tiket_antrean')
        .select('layanan:layanan_id(nama)')
        .eq('tanggal', today)
        .in('status', ['menunggu', 'dilayani', 'selesai']);

      const counts2: Record<string, number> = {};
      (breakdown ?? []).forEach((b) => {
        const layananObj = b.layanan;
        const nama = !layananObj
          ? null
          : Array.isArray(layananObj)
            ? (layananObj[0]?.nama ?? null)
            : ((layananObj as { nama: string }).nama ?? null);
        if (!nama) return;
        counts2[nama] = (counts2[nama] ?? 0) + 1;
      });
      setLayananBreakdownState(
        Object.entries(counts2)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([nama, jumlah], idx) => ({ nama, jumlah, color: CHART_COLORS[idx % CHART_COLORS.length] }))
      );
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

  return (
    <>
      <PageHeader
        title="Dashboard Utama"
        description="Ringkasan data kunjungan dan layanan hari ini"
      />

      <div className={styles.dashboard} style={{ padding: 'var(--space-8)' }}>

        <div className={styles.walkinTriggerContainer}>
          <WalkinWizard onSuccess={loadData} triggerClassName={styles.walkinTriggerBtn} />
          <Link href="/admin/petugas/invite" className="btn btn--secondary">
            <UserPlus size={20} />
            Tambah Petugas
          </Link>
          <Link href="/admin/data-governance" className="btn btn--secondary">
            <ShieldCheck size={20} />
            Tata Kelola Data (DPO)
          </Link>
          <Link href="/admin/skm" className="btn btn--secondary">
            <ClipboardList size={20} />
            Dashboard SKM
          </Link>
          <Link href="/admin/chat/ai-log" className="btn btn--secondary">
            <Bot size={20} />
            Log Asisten AI
          </Link>
        </div>

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
                  <span className={styles.statLabel}>Hadir Hari Ini (Walk-in + Reservasi)</span>
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
                  <span className={styles.statValue}>
                    {rataWaktu} <small style={{ fontSize: '0.5em', fontWeight: 400 }}>mnt</small>
                  </span>
                  <span className={styles.statLabel}>Rata-rata Waktu Layanan</span>
                </div>
              </div>
            </div>

            <div className={styles.chartsGrid}>
              <div className={styles.chartCard}>
                <h2 className={styles.chartTitle}>Volume Kunjungan Mingguan</h2>
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
                        <Bar dataKey="kunjungan" fill="#6366f1" radius={[6, 6, 0, 0]} name="Kunjungan" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
                      Belum ada data mingguan
                    </span>
                  )}
                </div>
              </div>

              <div className={styles.chartCard}>
                <h2 className={styles.chartTitle}>Breakdown per Layanan</h2>
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
                        <Legend verticalAlign="bottom" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '12px' }} />
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
                      Belum ada data layanan
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className={styles.recentSection}>
              <div className={styles.recentHeader}>
                <h2 className={styles.recentTitle}>Kunjungan Terbaru</h2>
                <Link href="/admin/kunjungan" className="btn btn--ghost btn--sm">
                  Lihat Semua <ArrowRight size={14} />
                </Link>
              </div>
              <div className="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>No. Tiket</th>
                      <th>Nama</th>
                      <th>Layanan</th>
                      <th>Waktu</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentVisits.length > 0 ? (
                      recentVisits.map((visit) => (
                        <tr key={visit.id}>
                          <td style={{ fontWeight: 600, color: 'var(--color-primary-700)' }}>{visit.nomor_display}</td>
                          <td style={{ fontWeight: 500 }}>{visit.nama}</td>
                          <td>{visit.layanan}</td>
                          <td>{visit.waktu}</td>
                          <td>
                            <span className={`badge badge--${visit.status}`}>
                              {visit.status === 'menunggu' ? '● Menunggu'
                                : visit.status === 'dilayani' ? 'Sedang Dilayani'
                                : '✓ Selesai'}
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 'var(--space-6)' }}>
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

        {/* layananList consumed only by WalkinWizard indirectly; kept for possible future use */}
        {layananList.length === 0 && false && null}
      </div>
    </>
  );
}