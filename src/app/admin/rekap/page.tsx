'use client';

// WP-30 & Fitur Pendataan Pelayanan: Admin recap dashboard.
// Mendukung:
// 1. Rekap Agregat Harian Layanan (rekap_harian_layanan)
// 2. Rekap Pelayanan Helpdesk OSS (v_rekap_pelayanan_oss)
// 3. Rekap Pelayanan Perizinan DPMPTSP (v_rekap_pelayanan_perizinan)

import { useState, useEffect, useCallback } from 'react';
import { todayWIB, addDaysWIB } from '@/lib/time';
import {
  BarChart2,
  RefreshCw,
  Download,
  TrendingUp,
  CheckCircle2,
  XCircle,
  Building2,
  FileCheck,
} from 'lucide-react';
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

interface RekapOssRow {
  id: string;
  tiket_id: string;
  nomor_display: string;
  tanggal: string;
  nama_pemohon: string;
  no_hp: string | null;
  nama_usaha: string;
  tipe_pelaku_usaha: string | null;
  status_penanaman_modal: string | null;
  lokasi_usaha: string | null;
  skala_usaha: string | null;
  sektor_usaha_kbli: string | null;
  tindak_lanjut: string;
  uraian_solusi: string;
  nama_petugas: string;
  status_draft: string;
  is_locked: boolean;
  created_at: string;
}

interface RekapPerizinanRow {
  id: string;
  tiket_id: string;
  nomor_display: string;
  tanggal: string;
  nama_pemohon: string;
  no_hp: string | null;
  nama_perusahaan: string;
  opd_teknis: string;
  uraian_permohonan: string;
  tindak_lanjut: string;
  catatan_petugas: string | null;
  nama_petugas: string;
  status_draft: string;
  is_locked: boolean;
  created_at: string;
}

type TabType = 'umum' | 'oss' | 'perizinan';

export default function AdminRekapPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<TabType>('umum');
  const [rows, setRows] = useState<RekapRow[]>([]);
  const [ossRows, setOssRows] = useState<RekapOssRow[]>([]);
  const [perizinanRows, setPerizinanRows] = useState<RekapPerizinanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [rolling, setRolling] = useState(false);
  const [mulai, setMulai] = useState(addDaysWIB(-6));
  const [selesai, setSelesai] = useState(todayWIB());

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();

      if (activeTab === 'umum') {
        const { data, error } = await supabase
          .from('rekap_harian_layanan')
          .select('*, layanan:layanan_id(nama)')
          .gte('tanggal', mulai)
          .lte('tanggal', selesai)
          .order('tanggal', { ascending: false })
          .order('layanan_id');
        if (error) throw error;
        setRows((data ?? []) as RekapRow[]);
      } else if (activeTab === 'oss') {
        const { data, error } = await supabase
          .from('v_rekap_pelayanan_oss')
          .select('*')
          .gte('tanggal', mulai)
          .lte('tanggal', selesai)
          .order('created_at', { ascending: false });
        if (error) throw error;
        setOssRows((data ?? []) as RekapOssRow[]);
      } else if (activeTab === 'perizinan') {
        const { data, error } = await supabase
          .from('v_rekap_pelayanan_perizinan')
          .select('*')
          .gte('tanggal', mulai)
          .lte('tanggal', selesai)
          .order('created_at', { ascending: false });
        if (error) throw error;
        setPerizinanRows((data ?? []) as RekapPerizinanRow[]);
      }
    } catch {
      toast('Gagal memuat rekap', 'error');
    } finally {
      setLoading(false);
    }
  }, [activeTab, mulai, selesai, toast]);

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

  const handleExportCsv = async () => {
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      let csv = '';
      let filename = '';

      if (activeTab === 'umum') {
        csv = [
          'Tanggal,Layanan,Hadir,Selesai,Tidak Terlayani,Rata Durasi (mnt)',
          ...rows.map((r) => {
            const nama = r.layanan ? (Array.isArray(r.layanan) ? r.layanan[0]?.nama : r.layanan.nama) : r.layanan_id;
            return `${r.tanggal},"${nama}",${r.total_hadir},${r.total_selesai},${r.total_tidak_terlayani},${r.rata_durasi_menit != null ? Math.round(r.rata_durasi_menit) : ''}`;
          }),
        ].join('\n');
        filename = `rekap_layanan_${mulai}_${selesai}.csv`;
      } else if (activeTab === 'oss') {
        csv = [
          'Tanggal,Nomor Tiket,Nama Pemohon,No HP,Nama Usaha,Tipe Pelaku Usaha,Status Penanaman Modal,Lokasi Usaha,Skala Usaha,KBLI,Tindakan,Uraian Solusi,Petugas,Status',
          ...ossRows.map((r) => {
            return `"${r.tanggal}","${r.nomor_display}","${r.nama_pemohon}","${r.no_hp || ''}","${r.nama_usaha}","${r.tipe_pelaku_usaha || ''}","${r.status_penanaman_modal || ''}","${r.lokasi_usaha || ''}","${r.skala_usaha || ''}","${r.sektor_usaha_kbli || ''}","${r.tindak_lanjut}","${(r.uraian_solusi || '').replace(/"/g, '""')}","${r.nama_petugas}","${r.status_draft}"`;
          }),
        ].join('\n');
        filename = `rekap_pelayanan_oss_${mulai}_${selesai}.csv`;
      } else if (activeTab === 'perizinan') {
        csv = [
          'Tanggal,Nomor Tiket,Nama Pemohon,No HP,Nama Perusahaan,OPD Teknis,Uraian Permohonan,Tindak Lanjut,Catatan Petugas,Petugas,Status',
          ...perizinanRows.map((r) => {
            return `"${r.tanggal}","${r.nomor_display}","${r.nama_pemohon}","${r.no_hp || ''}","${r.nama_perusahaan}","${r.opd_teknis}","${(r.uraian_permohonan || '').replace(/"/g, '""')}","${r.tindak_lanjut}","${(r.catatan_petugas || '').replace(/"/g, '""')}","${r.nama_petugas}","${r.status_draft}"`;
          }),
        ].join('\n');
        filename = `rekap_pelayanan_perizinan_${mulai}_${selesai}.csv`;
      }

      // RPT-06: Catat ekspor data ke audit_log
      if (user) {
        await supabase.from('audit_log').insert({
          actor_id: user.id,
          actor_role: 'admin',
          aksi: 'export_csv',
          entitas: `rekap_${activeTab}`,
          detail: { mulai, selesai, baris_count: activeTab === 'umum' ? rows.length : activeTab === 'oss' ? ossRows.length : perizinanRows.length },
        });
      }

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      toast('Berkas CSV berhasil diunduh', 'success');
    } catch {
      toast('Gagal mengekspor CSV', 'error');
    }
  };

  const totalHadir   = rows.reduce((s, r) => s + r.total_hadir, 0);
  const totalSelesai = rows.reduce((s, r) => s + r.total_selesai, 0);
  const totalAlpa    = rows.filter(r => r.petugas_alpa).length;

  return (
    <>
      <PageHeader
        title="Rekapitulasi Pelayanan &amp; Kunjungan"
        description="Laporan agregat harian dan data substantif konsultasi perizinan"
      >
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="date"
            className="form-input"
            value={mulai}
            onChange={(e) => setMulai(e.target.value)}
            style={{ width: 140, fontSize: 'var(--text-sm)', padding: 'var(--space-2) var(--space-3)' }}
          />
          <span style={{ color: 'var(--text-tertiary)' }}>s.d.</span>
          <input
            type="date"
            className="form-input"
            value={selesai}
            onChange={(e) => setSelesai(e.target.value)}
            style={{ width: 140, fontSize: 'var(--text-sm)', padding: 'var(--space-2) var(--space-3)' }}
          />
          <button className="btn btn--ghost btn--sm" onClick={loadData}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          {activeTab === 'umum' && (
            <button className="btn btn--primary btn--sm" onClick={handleRollupHariIni} disabled={rolling}>
              <BarChart2 size={16} /> {rolling ? 'Memproses…' : 'Rollup Hari Ini'}
            </button>
          )}
        </div>
      </PageHeader>

      <div style={{ padding: 'var(--space-8)' }}>
        {/* Navigation Tabs */}
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-2)',
            borderBottom: '1px solid var(--border-default)',
            marginBottom: 'var(--space-6)',
          }}
        >
          <button
            className={`btn ${activeTab === 'umum' ? 'btn--primary' : 'btn--ghost'} btn--sm`}
            onClick={() => setActiveTab('umum')}
            style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
          >
            <BarChart2 size={16} /> Rekap Umum Harian
          </button>
          <button
            className={`btn ${activeTab === 'oss' ? 'btn--primary' : 'btn--ghost'} btn--sm`}
            onClick={() => setActiveTab('oss')}
            style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
          >
            <Building2 size={16} /> Pendataan Helpdesk OSS
          </button>
          <button
            className={`btn ${activeTab === 'perizinan' ? 'btn--primary' : 'btn--ghost'} btn--sm`}
            onClick={() => setActiveTab('perizinan')}
            style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
          >
            <FileCheck size={16} /> Pendataan Perizinan DPMPTSP
          </button>
        </div>

        {/* TAB 1: REKAP UMUM */}
        {activeTab === 'umum' && (
          <>
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

            <div className="table-wrapper">
              {loading ? (
                <table className="table" aria-hidden="true">
                  <tbody>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i}>
                        <td colSpan={7}><div className="skeleton" style={{ height: 20, width: '100%' }} /></td>
                      </tr>
                    ))}
                  </tbody>
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
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 'var(--space-8)' }}>
                          Belum ada rekap. Klik “Rollup Hari Ini” untuk mengisi data.
                        </td>
                      </tr>
                    ) : (
                      rows.map((r, i) => {
                        const layananNama = r.layanan ? (Array.isArray(r.layanan) ? r.layanan[0]?.nama : r.layanan.nama) : r.layanan_id;
                        return (
                          <tr key={i}>
                            <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.tanggal}</td>
                            <td style={{ fontWeight: 600 }}>{layananNama}</td>
                            <td>{r.total_hadir}</td>
                            <td><span style={{ color: 'var(--color-success-700)', fontWeight: 600 }}>{r.total_selesai}</span></td>
                            <td>{r.total_tidak_terlayani > 0 ? <span style={{ color: 'var(--color-danger-700)' }}>{r.total_tidak_terlayani}</span> : '0'}</td>
                            <td>{r.rata_durasi_menit != null ? `${Math.round(r.rata_durasi_menit)} mnt` : '—'}</td>
                            <td>
                              {r.petugas_alpa ? (
                                <span className="badge badge--nonaktif">Alpa</span>
                              ) : r.petugas_hadir ? (
                                <span className="badge badge--aktif">Hadir</span>
                              ) : (
                                <span className="badge badge--draft">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {/* TAB 2: PENDATAAN HELPDESK OSS */}
        {activeTab === 'oss' && (
          <div className="table-wrapper">
            {loading ? (
              <table className="table" aria-hidden="true">
                <tbody>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={8}><div className="skeleton" style={{ height: 20, width: '100%' }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Tanggal / Tiket</th>
                    <th>Pemohon</th>
                    <th>Nama Usaha &amp; Tipe</th>
                    <th>Lokasi &amp; Penanaman Modal</th>
                    <th>KBLI &amp; Skala</th>
                    <th>Tindakan</th>
                    <th>Uraian Solusi</th>
                    <th>Petugas</th>
                  </tr>
                </thead>
                <tbody>
                  {ossRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 'var(--space-8)' }}>
                        Belum ada data pendataan Helpdesk OSS pada rentang tanggal ini.
                      </td>
                    </tr>
                  ) : (
                    ossRows.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <div style={{ fontWeight: 700, color: 'var(--color-primary-700)' }}>{r.nomor_display}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{r.tanggal}</div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{r.nama_pemohon}</div>
                          {r.no_hp && <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{r.no_hp}</div>}
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{r.nama_usaha}</div>
                          {r.tipe_pelaku_usaha && (
                            <div style={{ fontSize: '11px', color: 'var(--color-primary-700)' }}>
                              {r.tipe_pelaku_usaha === 'perseorangan' ? 'Perseorangan' : 'Badan Usaha'}
                            </div>
                          )}
                        </td>
                        <td>
                          <div>{r.lokasi_usaha || '—'}</div>
                          {r.status_penanaman_modal && r.status_penanaman_modal !== 'tidak_ada' && (
                            <span className="badge badge--aktif" style={{ fontSize: '10px', marginTop: '2px' }}>
                              {r.status_penanaman_modal}
                            </span>
                          )}
                        </td>
                        <td>
                          <div>{r.sektor_usaha_kbli || '—'}</div>
                          {r.skala_usaha && (
                            <span className="badge badge--draft" style={{ fontSize: '10px', marginTop: '2px' }}>
                              {r.skala_usaha}
                            </span>
                          )}
                        </td>
                        <td>
                          <span className="badge badge--aktif" style={{ fontSize: '11px' }}>
                            {r.tindak_lanjut}
                          </span>
                        </td>
                        <td style={{ maxWidth: '240px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                          {r.uraian_solusi}
                        </td>
                        <td style={{ fontSize: '12px', fontWeight: 500 }}>{r.nama_petugas}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* TAB 3: PENDATAAN PERIZINAN DPMPTSP */}
        {activeTab === 'perizinan' && (
          <div className="table-wrapper">
            {loading ? (
              <table className="table" aria-hidden="true">
                <tbody>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={7}><div className="skeleton" style={{ height: 20, width: '100%' }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Tanggal / Tiket</th>
                    <th>Pemohon / Perusahaan</th>
                    <th>OPD Teknis</th>
                    <th>Uraian Permohonan</th>
                    <th>Tindak Lanjut</th>
                    <th>Catatan Petugas</th>
                    <th>Petugas</th>
                  </tr>
                </thead>
                <tbody>
                  {perizinanRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 'var(--space-8)' }}>
                        Belum ada data pendataan Perizinan DPMPTSP pada rentang tanggal ini.
                      </td>
                    </tr>
                  ) : (
                    perizinanRows.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <div style={{ fontWeight: 700, color: 'var(--color-primary-700)' }}>{r.nomor_display}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{r.tanggal}</div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{r.nama_pemohon}</div>
                          {r.nama_perusahaan && (
                            <div style={{ fontSize: '12px', color: 'var(--color-primary-700)', fontWeight: 500 }}>
                              {r.nama_perusahaan}
                            </div>
                          )}
                          {r.no_hp && <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{r.no_hp}</div>}
                        </td>
                        <td>
                          <span className="badge badge--aktif" style={{ fontSize: '11px' }}>
                            {r.opd_teknis}
                          </span>
                        </td>
                        <td style={{ maxWidth: '240px', fontSize: '12px', color: 'var(--text-primary)', fontWeight: 500 }}>
                          {r.uraian_permohonan}
                        </td>
                        <td>
                          <span className="badge badge--draft" style={{ fontSize: '11px' }}>
                            {r.tindak_lanjut}
                          </span>
                        </td>
                        <td style={{ maxWidth: '240px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                          {r.catatan_petugas || '—'}
                        </td>
                        <td style={{ fontSize: '12px', fontWeight: 500 }}>{r.nama_petugas}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Download CSV Button */}
        <div style={{ marginTop: 'var(--space-4)', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn--ghost btn--sm" onClick={handleExportCsv}>
            <Download size={14} /> Unduh CSV (
            {activeTab === 'umum'
              ? 'Rekap Umum'
              : activeTab === 'oss'
              ? `OSS - ${ossRows.length} baris`
              : `Perizinan - ${perizinanRows.length} baris`}
            )
          </button>
        </div>
      </div>
    </>
  );
}
