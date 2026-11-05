'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Loader2, Search, ClipboardList } from 'lucide-react';
import { formatTanggalWaktu } from '@/lib/utils';
import { tampilWaktuLaporan } from '@/lib/waktu-anonim';

// CMP-05: lacak pengaduan tanpa login — nomor tiket + kontak.
type Tanggapan = { id: string; isi: string; created_at: string; lampiran: Array<{ id: string; nama: string; mime: string; ukuran: number }> };
type Hasil = { nomor_tiket: string; jalur: string; status: string; dibuat_pada: string; tanggapan?: Tanggapan[] };

const STATUS_LABEL: Record<string, string> = {
  baru: 'Diterima',
  diverifikasi: 'Diverifikasi',
  diproses: 'Sedang Diproses',
  eskalasi: 'Dieskalasi ke Pimpinan',
  selesai: 'Selesai',
  ditolak: 'Ditolak',
};

// Dua jenis nomor: laporan baru (cukup nomor) dan laporan lama (nomor tiket + kontak saat melapor).
type JenisNomor = 'baru' | 'lama';

export default function LacakPengaduanPage() {
  const [jenis, setJenis] = useState<JenisNomor>('baru');
  const hasilRef = useRef<HTMLDivElement>(null);
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
      // Kontak hanya untuk laporan lama; pada laporan baru server mencari dengan nomor saja.
      const kontakKirim = jenis === 'lama' ? kontak.trim() : '';
      const res = await fetch(`/api/pengaduan/lacak?tiket=${encodeURIComponent(tiket.trim())}&kontak=${encodeURIComponent(kontakKirim)}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Pengaduan tidak ditemukan.');
        return;
      }
      setHasil(json as Hasil);
      // Hasil muncul di bawah formulir (di HP: di luar layar): pindahkan fokus + gulir, dan diumumkan lewat role=status.
      setTimeout(() => {
        hasilRef.current?.focus();
        hasilRef.current?.scrollIntoView?.({ block: 'start' });
      }, 0);
    } catch {
      setError('Gangguan jaringan. Coba lagi.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: 'var(--space-6) var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
        <ClipboardList size={28} aria-hidden="true" style={{ color: 'var(--color-primary-500)' }} />
        <div>
          <h1 style={{ margin: 0 }}>Lacak Pengaduan</h1>
          <p style={{ margin: 0, color: 'var(--color-neutral-500)' }}>Pilih jenis nomor yang Anda pegang, lalu masukkan nomornya.</p>
        </div>
      </div>

      <form onSubmit={handleCari} className="card" style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 'var(--space-2)' }}>
          <legend style={{ fontWeight: 600, padding: 0, marginBottom: 'var(--space-2)' }}>Jenis nomor Anda</legend>
          <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start', minHeight: 44 }}>
            <input
              type="radio"
              name="jenis"
              value="baru"
              checked={jenis === 'baru'}
              onChange={() => { setJenis('baru'); setKontak(''); setError(''); }}
              style={{ marginTop: 4 }}
              aria-labelledby="jenis-baru-judul"
              aria-describedby="jenis-baru-ket"
            />
            <span>
              <strong id="jenis-baru-judul">Laporan baru</strong>
              <span id="jenis-baru-ket" style={{ display: 'block', color: 'var(--color-neutral-500)' }}>Saya punya nomor laporan (dari survei atau pengaduan terbaru). Cukup nomornya.</span>
            </span>
          </label>
          <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start', minHeight: 44 }}>
            <input
              type="radio"
              name="jenis"
              value="lama"
              checked={jenis === 'lama'}
              onChange={() => { setJenis('lama'); setError(''); }}
              style={{ marginTop: 4 }}
              aria-labelledby="jenis-lama-judul"
              aria-describedby="jenis-lama-ket"
            />
            <span>
              <strong id="jenis-lama-judul">Laporan lama</strong>
              <span id="jenis-lama-ket" style={{ display: 'block', color: 'var(--color-neutral-500)' }}>Saya punya nomor tiket pengaduan lama dan ingat kontak (email / no. HP) saat melapor.</span>
            </span>
          </label>
        </fieldset>
        <div>
          <label htmlFor="tiket" style={{ fontWeight: 600, display: 'block', marginBottom: 'var(--space-2)' }}>
            {jenis === 'baru' ? 'Nomor laporan' : 'Nomor tiket'}
          </label>
          <input id="tiket" className="input" value={tiket} onChange={(e) => setTiket(e.target.value)} placeholder="contoh: PK7M2N9XQ" required />
        </div>
        {jenis === 'lama' && (
          <div>
            <label htmlFor="kontak" style={{ fontWeight: 600, display: 'block', marginBottom: 'var(--space-2)' }}>Kontak (email / no. HP) saat melapor</label>
            <input id="kontak" className="input" value={kontak} onChange={(e) => setKontak(e.target.value)} placeholder="kontak saat melapor" required />
          </div>
        )}
        {error && (
          <p role="alert" style={{ color: 'var(--color-danger-600, #dc2626)', display: 'flex', gap: 6, alignItems: 'center' }}>
            <AlertCircle size={16} aria-hidden="true" /> {error}
          </p>
        )}
        <button type="submit" className="btn btn--primary" disabled={loading}>
          {loading ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Search size={16} aria-hidden="true" />} Lacak Status
        </button>
      </form>

      {hasil && (
        <div ref={hasilRef} tabIndex={-1} role="status" className="card" style={{ marginTop: 'var(--space-4)', outlineOffset: 2 }}>
          <h2 style={{ marginTop: 0 }}>Status Pengaduan</h2>
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px' }}>
            <dt style={{ color: 'var(--color-neutral-500)' }}>Nomor Tiket</dt>
            <dd style={{ margin: 0, fontFamily: 'monospace', fontWeight: 700 }}>{hasil.nomor_tiket}</dd>
            <dt style={{ color: 'var(--color-neutral-500)' }}>Jalur</dt>
            <dd style={{ margin: 0 }}>{hasil.jalur === 'integritas' ? 'Integritas (rahasia)' : 'Layanan'}</dd>
            <dt style={{ color: 'var(--color-neutral-500)' }}>Status</dt>
            <dd style={{ margin: 0, fontWeight: 600 }}>{STATUS_LABEL[hasil.status] ?? hasil.status}</dd>
            <dt style={{ color: 'var(--color-neutral-500)' }}>Dibuat</dt>
            <dd style={{ margin: 0 }}>{tampilWaktuLaporan(hasil.dibuat_pada, 'otomatis')}</dd>
          </dl>
          {hasil.tanggapan && hasil.tanggapan.length > 0 && (
            <>
              <h3>Tanggapan Petugas</h3>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-3)' }}>
                {hasil.tanggapan.map((t) => (
                  <li key={t.id} style={{ borderLeft: '3px solid var(--color-primary-500)', paddingLeft: 'var(--space-3)' }}>
                    <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{t.isi}</p>
                    <small style={{ color: 'var(--color-neutral-500)' }}>{formatTanggalWaktu(t.created_at)}</small>
                    {t.lampiran.length > 0 && (
                      <ul style={{ margin: 'var(--space-1) 0 0', paddingLeft: 18 }}>
                        {t.lampiran.map((l) => (
                          <li key={l.id}>
                            <a href={`/api/pengaduan/lampiran?nomor=${encodeURIComponent(hasil.nomor_tiket)}&id=${l.id}`}>{l.nama}</a>{' '}
                            <small style={{ color: 'var(--color-neutral-500)' }}>({Math.max(1, Math.round(l.ukuran / 1024))} KB)</small>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <p style={{ marginTop: 'var(--space-4)', textAlign: 'center' }}>
        <Link href="/pengaduan" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>Buat pengaduan baru</Link>
      </p>
    </main>
  );
}
