'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Lightbulb, Loader2, Send } from 'lucide-react';

// Kotak saran publik: tanpa login dan tanpa harus selesai dilayani. Nama opsional; tidak ada kaitan ke kunjungan atau akun.
const BATAS_ISI = 2000;
const rowStyle: React.CSSProperties = { fontWeight: 600, display: 'block', marginBottom: 'var(--space-2)' };

type Phase = 'form' | 'submitting' | 'done';

export default function SaranPage() {
  const [isi, setIsi] = useState('');
  const [nama, setNama] = useState('');
  const [website, setWebsite] = useState(''); // jebakan bot: manusia tidak melihat kolom ini
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (isi.trim().length < 5) {
      setError('Mohon tulis saran Anda, minimal 5 karakter.');
      return;
    }
    setPhase('submitting');
    try {
      const res = await fetch('/api/saran', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isi: isi.trim(), nama: nama.trim() || undefined, website: website || undefined }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? 'Gagal mengirim saran. Coba lagi.');
        setPhase('form');
        return;
      }
      setPhase('done');
    } catch {
      setError('Gangguan jaringan. Coba lagi.');
      setPhase('form');
    }
  };

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 'var(--space-6) var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
        <Lightbulb size={28} style={{ color: 'var(--color-primary-500)', flexShrink: 0, marginTop: 4 }} />
        <div>
          <h1 style={{ margin: 0 }}>Kotak Saran</h1>
          <p style={{ margin: 0, color: 'var(--color-neutral-500)' }}>
            Sampaikan saran atau masukan untuk pelayanan DPMPTSP Provinsi Lampung. Tidak perlu masuk akun dan tidak perlu
            sudah dilayani.
          </p>
        </div>
      </div>

      {phase === 'done' ? (
        <div className="card" role="status" style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
          <CheckCircle2 size={48} style={{ color: 'var(--color-success-500, #16a34a)', margin: '0 auto' }} />
          <h2 style={{ marginTop: 'var(--space-4)' }}>Terima kasih, saran Anda sudah kami terima.</h2>
          <p style={{ color: 'var(--color-neutral-500)' }}>Masukan Anda membantu kami melayani lebih baik.</p>
          <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center', marginTop: 'var(--space-4)' }}>
            <Link href="/" className="btn btn--primary">Kembali ke Beranda</Link>
            <Link href="/pengaduan" className="btn btn--secondary">Sampaikan Pengaduan</Link>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="card" style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <div>
            <label htmlFor="isi-saran" style={rowStyle}>
              Saran Anda <span style={{ color: 'red' }} aria-hidden="true">*</span>
            </label>
            <textarea
              id="isi-saran"
              className="input"
              rows={6}
              maxLength={BATAS_ISI}
              value={isi}
              onChange={(e) => setIsi(e.target.value)}
              placeholder="Tulis saran atau masukan Anda…"
              required
            />
            <p style={{ margin: '4px 0 0', fontSize: 'var(--text-xs)', color: 'var(--color-neutral-500)', textAlign: 'right' }}>
              {isi.length}/{BATAS_ISI}
            </p>
          </div>

          <div>
            <label htmlFor="nama-saran" style={rowStyle}>
              Nama <span style={{ fontWeight: 400, color: 'var(--color-neutral-500)' }}>(boleh dikosongkan)</span>
            </label>
            <input
              id="nama-saran"
              className="input"
              type="text"
              maxLength={120}
              autoComplete="name"
              value={nama}
              onChange={(e) => setNama(e.target.value)}
              placeholder="Kosongkan bila ingin tanpa nama"
            />
            <p style={{ margin: '4px 0 0', fontSize: 'var(--text-xs)', color: 'var(--color-neutral-500)' }}>
              Tanpa nama pun saran tetap kami baca. Kami tidak meminta email atau nomor HP.
            </p>
          </div>

          {/* Jebakan bot: tersembunyi dari pengguna dan pembaca layar; bot yang mengisinya diabaikan server. */}
          <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
            <label htmlFor="website-saran">Situs web</label>
            <input id="website-saran" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>

          {error && (
            <p role="alert" style={{ color: 'var(--color-danger-600, #dc2626)', display: 'flex', gap: '6px', alignItems: 'center' }}>
              <AlertCircle size={16} /> {error}
            </p>
          )}

          <button type="submit" className="btn btn--primary" disabled={phase === 'submitting'}>
            {phase === 'submitting' ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />} Kirim Saran
          </button>
        </form>
      )}

      <p style={{ marginTop: 'var(--space-4)', textAlign: 'center' }}>
        Ada hal kurang baik yang ingin dilaporkan?{' '}
        <Link href="/pengaduan" style={{ display: 'inline-flex', minHeight: 44, alignItems: 'center' }}>
          Sampaikan pengaduan (bisa anonim)
        </Link>
      </p>
    </main>
  );
}
