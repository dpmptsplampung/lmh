'use client';

// Rekap penanganan per tahap (Tahap D): dipakai /admin/rekap-fo (peran 'fo') dan tab "Rekap Petugas Layanan"
// di /admin/rekap (peran 'layanan'). Hak akses ditegakkan server (api/admin/rekap/penanganan); komponen ini hanya
// menyesuaikan tampilan (mis. Front Office tidak punya filter FO karena selalu terkunci ke dirinya).
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Download, Loader2, RefreshCw } from 'lucide-react';
import Pagination from '@/components/Pagination';
import RoleNote from '@/components/admin/RoleNote';
import { useToast } from '@/components/Toast';
import { createClient } from '@/lib/supabase/client';
import { addDaysWIB, todayWIB } from '@/lib/time';
import {
  formatMenit,
  formatTanggalId,
  formatWaktuId,
  labelHasilTahap,
  labelSaluran,
} from '@/lib/rekap/format';
import type { PeranTahap, RekapPenangananRow, RingkasanPenanganan } from '@/lib/rekap/penanganan';

const PAGE_SIZE = 25;

export interface OpsiLayanan {
  id: string;
  nama: string;
}

interface OpsiPetugas {
  id: string;
  nama: string;
  aktif: boolean;
}

interface Props {
  peran: PeranTahap;
  /** Hanya peran 'layanan': petugas dikunci ke layanannya. */
  isPetugas?: boolean;
  initialLayananId?: string | null;
  layananOptions?: OpsiLayanan[];
}

interface Respons {
  total: number;
  truncated: boolean;
  peran_saya: string;
  terkunci_ke_saya: boolean;
  ringkasan: RingkasanPenanganan;
  rows: RekapPenangananRow[];
}

const sel = { width: 200 } as const;

export default function RekapPenangananTable({ peran, isPetugas = false, initialLayananId = null, layananOptions = [] }: Props) {
  const { toast } = useToast();
  const idAwal = peran === 'fo' ? 'rekap-fo' : 'rekap-lyn';
  const [dari, setDari] = useState(() => addDaysWIB(-6));
  const [sampai, setSampai] = useState(() => todayWIB());
  const [petugasId, setPetugasId] = useState('');
  const [layananId, setLayananId] = useState(initialLayananId ?? '');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Respons | null>(null);
  const [opsiPetugas, setOpsiPetugas] = useState<OpsiPetugas[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);
  const opsiDimuat = useRef(false);

  const params = useCallback(
    (tambah: Record<string, string> = {}) => {
      const p = new URLSearchParams({ peran, dari, sampai, ...tambah });
      if (petugasId) p.set('petugas_id', petugasId);
      if (layananId && peran === 'layanan') p.set('layanan_id', layananId);
      return p;
    },
    [peran, dari, sampai, petugasId, layananId],
  );

  const muat = useCallback(async () => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/rekap/penanganan?${params({ page: String(page), page_size: String(PAGE_SIZE) })}`);
      const body = await res.json().catch(() => ({}));
      if (seq !== seqRef.current) return; // respons lama tidak boleh menimpa yang lebih baru
      if (!res.ok) {
        const pesan = res.status === 403 ? 'Anda tidak berwenang melihat rekap ini' : (body.error ?? 'Gagal memuat rekap');
        setError(pesan);
        setData(null);
        toast(pesan, 'error');
        return;
      }
      setData(body as Respons);
    } catch {
      if (seq !== seqRef.current) return;
      setError('Tidak ada koneksi');
      toast('Tidak ada koneksi', 'error');
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [params, page, toast]);

  useEffect(() => {
    const t = setTimeout(() => void muat(), 0);
    return () => clearTimeout(t);
  }, [muat]);

  // Daftar penangan untuk filter Admin (FO/Admin untuk rekap FO; petugas untuk rekap layanan). Dimuat sekali.
  const adalahAdmin = data?.peran_saya === 'admin';
  useEffect(() => {
    if (!adalahAdmin || opsiDimuat.current) return;
    opsiDimuat.current = true;
    void (async () => {
      try {
        const { data: d, error: e } = await createClient()
          .from('petugas')
          .select('id, nama, aktif')
          .in('role', peran === 'fo' ? ['front_office', 'admin'] : ['petugas'])
          .order('nama');
        if (!e) setOpsiPetugas((d ?? []) as OpsiPetugas[]);
      } catch {
        // filter opsional: rekap tetap bisa dipakai tanpa daftar
      }
    })();
  }, [adalahAdmin, peran]);

  const unduh = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/admin/rekap/penanganan/export?${params()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast(body.error ?? 'Gagal mengekspor Excel', 'error');
        return;
      }
      const blob = await res.blob();
      const nama = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'rekap-penanganan.xlsx';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nama;
      a.click();
      URL.revokeObjectURL(url);
      if (res.headers.get('X-Rekap-Truncated') === 'true') {
        toast('Data terpotong ke 50.000 baris. Persempit rentang tanggal.', 'warning');
      } else {
        toast('Berkas Excel berhasil diunduh', 'success');
      }
    } catch {
      toast('Gagal mengekspor Excel', 'error');
    } finally {
      setExporting(false);
    }
  };

  const labelPenangan = peran === 'fo' ? 'Front Office' : 'Petugas';
  const ringkasan = data?.ringkasan;
  const kosong = !loading && !error && data != null && data.total === 0;

  return (
    <div>
      {data?.terkunci_ke_saya && (
        <RoleNote>Anda hanya melihat penanganan Anda sendiri. Setiap ekspor tercatat.</RoleNote>
      )}
      {peran === 'layanan' && isPetugas && (
        <RoleNote>
          Data ini hanya untuk layanan {layananOptions.find((o) => o.id === initialLayananId)?.nama ?? 'Anda'}.
          Hanya tahap yang tercatat lewat alur Front Office; tiket lama ada di tab Rekap Per Layanan.
        </RoleNote>
      )}

      <div
        style={{
          display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'flex-end',
          padding: 'var(--space-4)', background: '#ffffff', borderRadius: 'var(--radius-lg, 12px)',
          border: '1px solid var(--border-default, #e2e8f0)', marginBottom: 'var(--space-4)',
        }}
      >
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label" htmlFor={`${idAwal}-dari`}>Dari tanggal</label>
          <input id={`${idAwal}-dari`} type="date" className="form-input" value={dari}
            onChange={(e) => { setDari(e.target.value); setPage(0); }} />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label" htmlFor={`${idAwal}-sampai`}>Sampai tanggal</label>
          <input id={`${idAwal}-sampai`} type="date" className="form-input" value={sampai}
            onChange={(e) => { setSampai(e.target.value); setPage(0); }} />
        </div>
        {adalahAdmin && (
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor={`${idAwal}-petugas`}>{labelPenangan}</label>
            <select id={`${idAwal}-petugas`} className="form-input" style={sel} value={petugasId}
              onChange={(e) => { setPetugasId(e.target.value); setPage(0); }}>
              <option value="">Semua</option>
              {opsiPetugas.map((p) => (
                <option key={p.id} value={p.id}>{p.nama}{p.aktif ? '' : ' (nonaktif)'}</option>
              ))}
            </select>
          </div>
        )}
        {peran === 'layanan' && !isPetugas && (
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor={`${idAwal}-layanan`}>Layanan</label>
            <select id={`${idAwal}-layanan`} className="form-input" style={sel} value={layananId}
              onChange={(e) => { setLayananId(e.target.value); setPage(0); }}>
              <option value="">Semua Layanan</option>
              {layananOptions.map((o) => <option key={o.id} value={o.id}>{o.nama}</option>)}
            </select>
          </div>
        )}
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => void muat()} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
        <button type="button" className="btn btn--primary btn--sm" onClick={() => void unduh()}
          disabled={loading || exporting || !data || data.total === 0}>
          {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download Excel
        </button>
      </div>

      {data?.truncated && (
        <RoleNote>Data melebihi 50.000 baris dan dipotong. Persempit rentang tanggal agar ringkasan lengkap.</RoleNote>
      )}

      {error && (
        <div role="alert" style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-danger-700)' }}>
          <AlertCircle size={32} style={{ margin: '0 auto var(--space-3)' }} />
          <p>{error}</p>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => void muat()}>Coba Lagi</button>
        </div>
      )}

      {ringkasan && !error && (
        <>
          <div className="grid-stats" style={{ marginBottom: 'var(--space-4)' }}>
            <div className="stat-card">
              <span className="stat-card__value">{ringkasan.total}</span>
              <span className="stat-card__label">Total penanganan (rentang)</span>
            </div>
            {ringkasan.per_hasil.map((h) => (
              <div className="stat-card" key={h.kunci}>
                <span className="stat-card__value">{h.jumlah}</span>
                <span className="stat-card__label">{h.label}</span>
              </div>
            ))}
          </div>

          {ringkasan.total > 0 && (
            <div style={{ display: 'grid', gap: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', marginBottom: 'var(--space-4)' }}>
              <div className="table-wrapper">
                <table className="table" aria-label={`Ringkasan per ${labelPenangan.toLowerCase()} per hari`}>
                  <thead>
                    <tr>
                      <th>Tanggal</th><th>{labelPenangan}</th><th>Total</th><th>Selesai</th>
                      <th>Dieskalasi</th><th>Dikembalikan</th><th>Rata Durasi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ringkasan.per_penangan_hari.map((g) => (
                      <tr key={`${g.tanggal}-${g.penangan_id ?? ''}`}>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>{g.tanggal ? formatTanggalId(g.tanggal) : '—'}</td>
                        <td style={{ fontWeight: 600 }}>{g.nama}</td>
                        <td>{g.total}</td><td>{g.selesai}</td><td>{g.dieskalasi}</td><td>{g.dikembalikan}</td>
                        <td>{formatMenit(g.rata_durasi_menit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="table-wrapper">
                <table className="table" aria-label="Ringkasan per topik">
                  <thead><tr><th>Topik</th><th>Jumlah</th></tr></thead>
                  <tbody>
                    {ringkasan.per_topik.length === 0 ? (
                      <tr><td colSpan={2} style={{ color: 'var(--text-tertiary)' }}>Belum ada tahap selesai.</td></tr>
                    ) : ringkasan.per_topik.map((t) => (
                      <tr key={t.topik}><td>{t.topik}</td><td>{t.jumlah}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      <div className="table-wrapper">
        {loading && !data ? (
          <table className="table" aria-hidden="true">
            <tbody>
              {Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}><td colSpan={9}><div className="skeleton" style={{ height: 20, width: '100%' }} /></td></tr>
              ))}
            </tbody>
          </table>
        ) : kosong ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--text-tertiary)' }}>
            <p>Tidak ada penanganan pada rentang tanggal ini.</p>
          </div>
        ) : data && !error ? (
          <table className="table" aria-label="Daftar penanganan">
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>{labelPenangan}</th>
                {peran === 'layanan' && <th>Layanan / Tiket</th>}
                <th>Pengunjung</th>
                <th>Saluran</th>
                <th>Mulai - Selesai</th>
                <th>Durasi</th>
                <th>Topik</th>
                <th>Hasil</th>
                <th>Catatan</th>
                {peran === 'layanan' && <th>Pendataan</th>}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.tanggal ? formatTanggalId(r.tanggal) : '—'}</td>
                  <td style={{ fontWeight: 600 }}>{r.penangan_nama ?? '—'}</td>
                  {peran === 'layanan' && (
                    <td>
                      <div>{r.layanan_nama ?? '—'}</div>
                      <div style={{ fontWeight: 700, color: 'var(--color-primary-700)' }}>{r.tiket?.nomor_display ?? ''}</div>
                    </td>
                  )}
                  <td>
                    <div>{r.pengunjung_nama ?? '—'}</div>
                    {peran === 'fo' && r.pengunjung_instansi && (
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{r.pengunjung_instansi}</div>
                    )}
                  </td>
                  <td>{labelSaluran(r.saluran)}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatWaktuId(r.mulai_at)} - {r.selesai_at ? formatWaktuId(r.selesai_at) : '…'}
                  </td>
                  <td>{formatMenit(r.durasi_menit)}</td>
                  <td>{r.topik ?? '—'}</td>
                  <td><span className="badge badge--draft">{labelHasilTahap(r)}</span></td>
                  <td style={{ maxWidth: 260, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{r.catatan ?? '—'}</td>
                  {peran === 'layanan' && (
                    <td style={{ fontSize: 'var(--text-xs)' }}>
                      {r.tiket?.pelayanan_oss
                        ? `OSS: ${r.tiket.pelayanan_oss.nama_pemohon} / ${r.tiket.pelayanan_oss.nama_usaha}`
                        : r.tiket?.pelayanan_perizinan
                          ? `Non OSS: ${r.tiket.pelayanan_perizinan.nama_pemohon} / ${r.tiket.pelayanan_perizinan.nama_perusahaan}`
                          : '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPageChange={setPage} />
      </div>
    </div>
  );
}
