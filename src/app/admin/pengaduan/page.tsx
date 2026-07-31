'use client';

import { useEffect, useState, useCallback } from 'react';
import { Loader2, AlertTriangle, ShieldAlert, Clock } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';

// CMP-02/CMP-03/CMP-06: dashboard pengaduan untuk Admin & FO.
// Jalur integritas hanya tampil untuk Admin (I-15); penanda warna mendekati batas SLA.

type Row = {
  id: string;
  nomor_tiket: string;
  jalur: 'layanan' | 'integritas';
  layanan_id: string | null;
  status: string;
  batas_verifikasi: string;
  batas_penanganan: string;
  anonim: boolean;
  created_at: string;
  isi: string;
};

const STATUS_LABEL: Record<string, string> = {
  baru: 'Baru', diverifikasi: 'Diverifikasi', diproses: 'Diproses',
  eskalasi: 'Eskalasi', selesai: 'Selesai', ditolak: 'Ditolak',
};

function hariMenuju(tanggal: string): number {
  const now = new Date();
  const target = new Date(`${tanggal}T23:59:59`);
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function SlaBadge({ batas }: { batas: string }) {
  const sisa = hariMenuju(batas);
  let color = 'var(--color-success-600, #16a34a)';
  if (sisa < 0) color = 'var(--color-danger-600, #dc2626)';
  else if (sisa <= 2) color = 'var(--color-warning-600, #d97706)';
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', color, fontWeight: 600, fontSize: 'var(--text-sm)' }}>
      <Clock size={13} /> {sisa < 0 ? `Lewat ${-sisa}h` : `${sisa}h kerja`}
    </span>
  );
}

export default function AdminPengaduanPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'layanan' | 'integritas'>('layanan');
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/pengaduan?jalur=${tab}`);
      const json = await res.json();
      if (res.status === 403 && tab === 'integritas') {
        setRows([]);
        setError('Jalur integritas hanya dapat diakses oleh Admin.');
        return;
      }
      if (!res.ok) {
        setError(json.error ?? 'Gagal memuat');
        return;
      }
      setRows(json.rows ?? []);
      // Deteksi admin: kalau tab integritas bisa diakses tanpa 403, berarti admin.
      setIsAdmin(true);
    } catch {
      setError('Gangguan jaringan.');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const ubahStatus = async (id: string, status: string) => {
    await fetch('/api/admin/pengaduan', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    void load();
  };

  return (
    <div style={{ padding: 'var(--space-6)' }}>
      <PageHeader title="Kanal Pengaduan" />
      <div style={{ display: 'flex', gap: 'var(--space-2)', margin: 'var(--space-4) 0' }}>
        <button
          type="button"
          className={`btn ${tab === 'layanan' ? 'btn--primary' : 'btn--secondary'}`}
          onClick={() => setTab('layanan')}
        >
          Pengaduan Layanan
        </button>
        {isAdmin && (
          <button
            type="button"
            className={`btn ${tab === 'integritas' ? 'btn--primary' : 'btn--secondary'}`}
            onClick={() => setTab('integritas')}
          >
            <ShieldAlert size={14} /> Integritas (rahasia)
          </button>
        )}
      </div>

      {error && <p style={{ color: 'var(--color-danger-600, #dc2626)' }}>{error}</p>}
      {loading ? (
        <Loader2 className="spin" />
      ) : rows.length === 0 ? (
        <p style={{ color: 'var(--color-neutral-500)' }}>Belum ada pengaduan pada jalur ini.</p>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
          {rows.map((r) => (
            <div key={r.id} className="card" style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <strong style={{ fontFamily: 'monospace' }}>{r.nomor_tiket}</strong>
                <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                  {r.jalur === 'integritas' && (
                    <span style={{ color: 'var(--color-danger-600, #dc2626)', display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 'var(--text-sm)' }}>
                      <AlertTriangle size={13} /> Integritas
                    </span>
                  )}
                  <span className="badge">{STATUS_LABEL[r.status] ?? r.status}</span>
                </span>
              </div>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.isi}</p>
              <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', alignItems: 'center', fontSize: 'var(--text-sm)', color: 'var(--color-neutral-500)' }}>
                <span>{new Date(r.created_at).toLocaleString('id-ID')}</span>
                <span>Verifikasi: <SlaBadge batas={r.batas_verifikasi} /></span>
                <span>Penanganan: <SlaBadge batas={r.batas_penanganan} /></span>
                {r.anonim && <span>(anonim)</span>}
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                {r.status === 'baru' && (
                  <button type="button" className="btn btn--sm btn--secondary" onClick={() => ubahStatus(r.id, 'diverifikasi')}>Verifikasi</button>
                )}
                {(r.status === 'baru' || r.status === 'diverifikasi') && (
                  <button type="button" className="btn btn--sm btn--secondary" onClick={() => ubahStatus(r.id, 'diproses')}>Proses</button>
                )}
                {r.status !== 'selesai' && r.status !== 'ditolak' && (
                  <>
                    <button type="button" className="btn btn--sm btn--primary" onClick={() => ubahStatus(r.id, 'selesai')}>Selesaikan</button>
                    <button type="button" className="btn btn--sm btn--secondary" onClick={() => ubahStatus(r.id, 'ditolak')}>Tolak</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
