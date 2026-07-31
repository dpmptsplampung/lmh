'use client';

// WP-30 / RPT-01..06, RPT-08, RBA-10: Admin recap dashboard.
// Reads from rekap_harian_layanan (populated by rollup_rekap_harian cron).
// Admin can also trigger a manual rollup for today.

import { useState, useEffect, useCallback } from 'react';
import { todayWIB, addDaysWIB } from '@/lib/time';
import { BarChart2, RefreshCw, Download, TrendingUp, CheckCircle2, XCircle } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';

interface RekapRow {
  layanan_id: string;
  tanggal: string;
  total_hadir: number;
  total_selesai: number;
  total_tidak_terlayani: number;
  total_batal: number;
  rata_durasi_menit: number | null;
  petugas_hadir: boolean;
  petugas_alpa: boolean;
  layanan?: { nama: string } | null;
}

export default function AdminRekapPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<RekapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [rolling, setRolling] = useState(false);
  const [mulai, setMulai] = useState(addDaysWIB(-6));
  const [selesai, setSelesai] = useState(todayWIB());

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('rekap_harian_layanan')
        .select('*, layanan:layanan_id(nama)')
        .gte('tanggal', mulai)
        .lte('tanggal', selesai)
        .order('tanggal', { ascending: false })
        .order('layanan_id');
      if (error) throw error;
      setRows((data ?? []) as RekapRow[]);
    } catch {
      toast('Gagal memuat rekap', 'error');
    } finally {
      setLoading(false);
    }
  }, [mulai, selesai, toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  const handleRollupHariIni = async () => {
    setRolling(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('rollup_rekap_harian', { p_tanggal: todayWIB() });
      if (error) throw error;
      toast('Rekap hari ini berhasil diperbarui', 'success');
      await loadData();
    } catch {
      toast('Gagal menjalankan rollup', 'error');
    } finally {
      setRolling(false);
    }
  };

  const totalHadir   = rows.reduce((s, r) => s + r.total_hadir, 0);
  const totalSelesai = rows.reduce((s, r) => s + r.total_selesai, 0);
  const totalAlpa    = rows.filter(r => r.petugas_alpa).length;

  return (
    <>
      <PageHeader
        title="Rekap Harian Layanan"
        description="Agregat kunjungan dan kepatuhan petugas per layanan per hari"
      >
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" className="form-input" value={mulai} onChange={e => setMulai(e.target.value)}
            style={{ width: 150, fontSize: 'var(--text-sm)', padding: 'var(--space-2) var(--space-3)' }} />
          <span style={{ color: 'var(--text-tertiary)' }}>s.d.</span>
          <input type="date" className="form-input" value={selesai} onChange={e => setSelesai(e.target.value)}
            style={{ width: 150, fontSize: 'var(--text-sm)', padding: 'var(--space-2) var(--space-3)' }} />
          <button className="btn btn--ghost btn--sm" onClick={loadData}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button className="btn btn--primary btn--sm" onClick={handleRollupHariIni} disabled={rolling}>
            <BarChart2 size={16} /> {rolling ? 'Memproses…' : 'Rollup Hari Ini'}
          </button>
        </div>
      </PageHeader>

      <div style={{ padding: 'var(--space-8)' }}>
        {/* Summary stats */}
        <div className="grid-stats" style={{ marginBottom: 'var(--space-8)' }}>
          <div className="stat-card">
            <div className="stat-card__icon" style={{ background: 'var(--color-primary-50)', color: 'var(--color-primary-600)' }}>
              <TrendingUp size={22} />
            </div>
            <span className="stat-card__value">{totalHadir}</span>
            <span className="stat-card__label">Total Hadir (periode)</span>
          </div>
          <div className="stat-card">
            <div className="stat-card__icon" style={{ background: 'var(--color-success-50)', color: 'var(--color-success-600)' }}>
              <CheckCircle2 size={22} />
            </div>
            <span className="stat-card__value">{totalSelesai}</span>
            <span className="stat-card__label">Selesai Dilayani</span>
          </div>
          <div className="stat-card">
            <div className="stat-card__icon" style={{ background: 'var(--color-danger-50)', color: 'var(--color-danger-600)' }}>
              <XCircle size={22} />
            </div>
            <span className="stat-card__value">{totalAlpa}</span>
            <span className="stat-card__label">Hari-Layanan Petugas Alpa</span>
          </div>
        </div>
        {/* Table */}
        <div className="table-wrapper">
          {loading ? (
            <table className="table" aria-hidden="true">
              <tbody>{Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}><td colSpan={8}><div className="skeleton" style={{ height: 20, width: '100%' }} /></td></tr>
              ))}</tbody>
            </table>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Layanan</th>
                  <th>Hadir</th>
                  <th>Selesai</th>
                  <th>Tidak Terlayani</th>
                  <th>Rata Durasi</th>
                  <th>Petugas</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 'var(--space-8)' }}>
                    Belum ada rekap. Klik “Rollup Hari Ini” untuk mengisi data hari ini.
                  </td></tr>
                ) : rows.map((r, i) => {
                  const layananNama = r.layanan ? (Array.isArray(r.layanan) ? r.layanan[0]?.nama : (r.layanan as { nama: string }).nama) : r.layanan_id;
                  return (
                    <tr key={i}>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.tanggal}</td>
                      <td style={{ fontWeight: 600 }}>{layananNama}</td>
                      <td>{r.total_hadir}</td>
                      <td><span style={{ color: 'var(--color-success-700)', fontWeight: 600 }}>{r.total_selesai}</span></td>
                      <td>{r.total_tidak_terlayani > 0 ? <span style={{ color: 'var(--color-danger-700)' }}>{r.total_tidak_terlayani}</span> : '0'}</td>
                      <td>{r.rata_durasi_menit != null ? `${Math.round(r.rata_durasi_menit)} mnt` : '—'}</td>
                      <td>
                        {r.petugas_alpa
                          ? <span className="badge badge--nonaktif">Alpa</span>
                          : r.petugas_hadir
                            ? <span className="badge badge--aktif">Hadir</span>
                            : <span className="badge badge--draft">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {rows.length > 0 && (
          <div style={{ marginTop: 'var(--space-4)', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => {
                const csv = ['Tanggal,Layanan,Hadir,Selesai,Tidak Terlayani,Rata Durasi (mnt)',
                  ...rows.map(r => {
                    const nama = r.layanan ? (Array.isArray(r.layanan) ? r.layanan[0]?.nama : (r.layanan as { nama: string }).nama) : r.layanan_id;
                    return `${r.tanggal},"${nama}",${r.total_hadir},${r.total_selesai},${r.total_tidak_terlayani},${r.rata_durasi_menit != null ? Math.round(r.rata_durasi_menit) : ''}`;
                  })].join('\n');
                const blob = new Blob([csv], { type: 'text/csv' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `rekap_${mulai}_${selesai}.csv`;
                a.click();
              }}
            >
              <Download size={14} /> Unduh CSV
            </button>
          </div>
        )}
      </div>
    </>
  );
}
