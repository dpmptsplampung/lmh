'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Loader2, Search, ClipboardList } from 'lucide-react';

// CMP-05: lacak pengaduan tanpa login — nomor tiket + kontak.
type Hasil = { nomor_tiket: string; jalur: string; status: string; dibuat_pada: string };

const STATUS_LABEL: Record<string, string> = {
  baru: 'Diterima',
  diverifikasi: 'Diverifikasi',
  diproses: 'Sedang Diproses',
  eskalasi: 'Dieskalasi ke Pimpinan',
  selesai: 'Selesai',
  ditolak: 'Ditolak',
};

export default function LacakPengaduanPage() {
  const [tiket, setTiket] = useState('');
  const [kontak, setKontak] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasil, setHasil] = useState<Hasil | null>(null);

  const handleCari = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setHasil(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/pengaduan/lacak?tiket=${encodeURIComponent(tiket.trim())}&kontak=${encodeURIComponent(kontak.trim())}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Pengaduan tidak ditemukan.');
        return;
      }
      setHasil(json as Hasil);
    } catch {
      setError('Gangguan jaringan. Coba lagi.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: 'var(--space-6) var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
        <ClipboardList size={28} style={{ color: 'var(--color-primary-500)' }} />
        <div>
          <h1 style={{ margin: 0 }}>Lacak Pengaduan</h1>
          <p style={{ margin: 0, color: 'var(--color-neutral-500)' }}>Masukkan nomor tiket dan kontak yang Anda gunakan saat melapor.</p>
        </div>
      </div>

      <form onSubmit={handleCari} className="card" style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <div>
          <label htmlFor="tiket" style={{ fontWeight: 600, display: 'block', marginBottom: 'var(--space-2)' }}>Nomor Tiket</label>
          <input id="tiket" className="input" value={tiket} onChange={(e) => setTiket(e.target.value)} placeholder="contoh: P7K2N9X" required />
        </div>
        <div>
          <label htmlFor="kontak" style={{ fontWeight: 600, display: 'block', marginBottom: 'var(--space-2)' }}>Kontak (email / no. HP)</label>
          <input id="kontak" className="input" value={kontak} onChange={(e) => setKontak(e.target.value)} placeholder="kontak saat melapor" required />
        </div>
        {error && (
          <p style={{ color: 'var(--color-danger-600, #dc2626)', display: 'flex', gap: 6, alignItems: 'center' }}>
            <AlertCircle size={16} /> {error}
          </p>
        )}
        <button type="submit" className="btn btn--primary" disabled={loading}>
          {loading ? <Loader2 size={16} className="spin" /> : <Search size={16} />} Lacak Status
        </button>
      </form>

      {hasil && (
        <div className="card" style={{ marginTop: 'var(--space-4)' }}>
          <h2 style={{ marginTop: 0 }}>Status Pengaduan</h2>
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px' }}>
            <dt style={{ color: 'var(--color-neutral-500)' }}>Nomor Tiket</dt>
            <dd style={{ margin: 0, fontFamily: 'monospace', fontWeight: 700 }}>{hasil.nomor_tiket}</dd>
            <dt style={{ color: 'var(--color-neutral-500)' }}>Jalur</dt>
            <dd style={{ margin: 0 }}>{hasil.jalur === 'integritas' ? 'Integritas (rahasia)' : 'Layanan'}</dd>
            <dt style={{ color: 'var(--color-neutral-500)' }}>Status</dt>
            <dd style={{ margin: 0, fontWeight: 600 }}>{STATUS_LABEL[hasil.status] ?? hasil.status}</dd>
            <dt style={{ color: 'var(--color-neutral-500)' }}>Dibuat</dt>
            <dd style={{ margin: 0 }}>{new Date(hasil.dibuat_pada).toLocaleString('id-ID')}</dd>
          </dl>
        </div>
      )}

      <p style={{ marginTop: 'var(--space-4)', textAlign: 'center' }}>
        <Link href="/pengaduan">Buat pengaduan baru</Link>
      </p>
    </main>
  );
}
