'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Loader2, Send, ShieldAlert, ClipboardList } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

// CMP-01/CMP-05/CMP-06: formulir pengaduan publik (tanpa login wajib).
// Dua jalur: 'layanan' (boleh diteruskan ke layanan) & 'integritas' (rahasia, hanya Admin).

type LayananOpt = { id: string; nama: string };
type Phase = 'form' | 'submitting' | 'done' | 'error';

function PengaduanForm() {
  const [layananOptions, setLayananOptions] = useState<LayananOpt[]>([]);
  const [jalur, setJalur] = useState<'layanan' | 'integritas'>('layanan');
  const [layananId, setLayananId] = useState('');
  const [isi, setIsi] = useState('');
  const [kontak, setKontak] = useState('');
  const [anonim, setAnonim] = useState(false);
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState('');
  const [tiket, setTiket] = useState('');

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from('layanan')
      .select('id, nama')
      .eq('aktif', true)
      .order('nama')
      .then(({ data }) => setLayananOptions((data ?? []) as LayananOpt[]));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (isi.trim().length < 10) {
      setError('Mohon jelaskan pengaduan Anda minimal 10 karakter.');
      return;
    }
    if (!anonim && !kontak.trim()) {
      setError('Isi kontak (email/no. HP) untuk melacak status, atau centang "Kirim sebagai anonim".');
      return;
    }
    setPhase('submitting');
    try {
      const res = await fetch('/api/pengaduan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jalur,
          isi: isi.trim(),
          kontak: kontak.trim() || undefined,
          layanan_id: layananId || undefined,
          anonim,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Gagal mengirim pengaduan.');
        setPhase('error');
        return;
      }
      setTiket(json.nomor_tiket ?? '');
      setPhase('done');
    } catch {
      setError('Gangguan jaringan. Coba lagi.');
      setPhase('error');
    }
  };

  if (phase === 'done') {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
        <CheckCircle2 size={48} style={{ color: 'var(--color-success-500, #16a34a)', margin: '0 auto' }} />
        <h2 style={{ marginTop: 'var(--space-4)' }}>Pengaduan Tercatat</h2>
        <p>Nomor tiket Anda:</p>
        <p style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '0.05em', fontFamily: 'monospace' }}>{tiket}</p>
        <p style={{ color: 'var(--color-neutral-500)', fontSize: 'var(--text-sm)' }}>
          Simpan nomor tiket ini. Batas verifikasi 3 hari kerja, penanganan 14 hari kerja.
          {anonim ? '' : ' Lacak status dengan nomor tiket + kontak Anda.'}
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center', marginTop: 'var(--space-4)' }}>
          <Link href="/pengaduan/lacak" className="btn btn--primary">Lacak Pengaduan</Link>
          <Link href="/" className="btn btn--secondary">Kembali ke Beranda</Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card" style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <div>
        <label style={{ fontWeight: 600, display: 'block', marginBottom: 'var(--space-2)' }}>Jenis Pengaduan</label>
        <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
          <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start', cursor: 'pointer' }}>
            <input type="radio" name="jalur" checked={jalur === 'layanan'} onChange={() => setJalur('layanan')} />
            <span>
              <strong>Pengaduan Layanan</strong> — antrean lama, informasi tidak jelas, sistem error.
              Dapat diteruskan ke layanan terkait.
            </span>
          </label>
          <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start', cursor: 'pointer' }}>
            <input type="radio" name="jalur" checked={jalur === 'integritas'} onChange={() => setJalur('integritas')} />
            <span style={{ color: 'var(--color-danger-600, #dc2626)' }}>
              <strong>Pengaduan Perilaku / Integritas / Pungli</strong> — petugas minta uang, perilaku tidak pantas.
              <em> Dirahasiakan: hanya dibaca pimpinan, tidak oleh petugas.</em>
            </span>
          </label>
        </div>
      </div>

      {jalur === 'layanan' && (
        <div>
          <label htmlFor="layanan" style={{ fontWeight: 600, display: 'block', marginBottom: 'var(--space-2)' }}>
            Layanan terkait (opsional)
          </label>
          <select id="layanan" className="input" value={layananId} onChange={(e) => setLayananId(e.target.value)}>
            <option value="">— Umum / tidak spesifik —</option>
            {layananOptions.map((l) => (
              <option key={l.id} value={l.id}>{l.nama}</option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label htmlFor="isi" style={{ fontWeight: 600, display: 'block', marginBottom: 'var(--space-2)' }}>
          Uraian pengaduan <span style={{ color: 'red' }}>*</span>
        </label>
        <textarea
          id="isi"
          className="input"
          rows={5}
          value={isi}
          onChange={(e) => setIsi(e.target.value)}
          placeholder="Jelaskan kejadian, kapan, dan di mana. Hindari menyebut data pribadi orang lain."
          required
        />
      </div>

      <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', cursor: 'pointer' }}>
        <input type="checkbox" checked={anonim} onChange={(e) => setAnonim(e.target.checked)} />
        <span>Kirim sebagai anonim (tanpa kontak; status tidak bisa dilacak)</span>
      </label>

      {!anonim && (
        <div>
          <label htmlFor="kontak" style={{ fontWeight: 600, display: 'block', marginBottom: 'var(--space-2)' }}>
            Kontak (email / no. HP) untuk melacak status <span style={{ color: 'red' }}>*</span>
          </label>
          <input
            id="kontak"
            className="input"
            type="text"
            value={kontak}
            onChange={(e) => setKontak(e.target.value)}
            placeholder="contoh: nama@email.com atau 0812xxxxxxx"
          />
        </div>
      )}

      {error && (
        <p style={{ color: 'var(--color-danger-600, #dc2626)', display: 'flex', gap: '6px', alignItems: 'center' }}>
          <AlertCircle size={16} /> {error}
        </p>
      )}

      <button type="submit" className="btn btn--primary" disabled={phase === 'submitting'}>
        {phase === 'submitting' ? <Loader2 size={16} className="spin" /> : <Send size={16} />} Kirim Pengaduan
      </button>
    </form>
  );
}

export default function PengaduanPage() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 'var(--space-6) var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
        <ShieldAlert size={28} style={{ color: 'var(--color-primary-500)' }} />
        <div>
          <h1 style={{ margin: 0 }}>Kanal Pengaduan</h1>
          <p style={{ margin: 0, color: 'var(--color-neutral-500)' }}>
            Sampaikan keluhan layanan atau laporan integritas. Sesuai UU 25/2009 tentang Pelayanan Publik.
          </p>
        </div>
      </div>
      <Suspense fallback={<Loader2 className="spin" />}>
        <PengaduanForm />
      </Suspense>
      <p style={{ marginTop: 'var(--space-4)', textAlign: 'center' }}>
        <Link href="/pengaduan/lacak" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <ClipboardList size={14} /> Sudah punya tiket? Lacak status pengaduan
        </Link>
      </p>
    </main>
  );
}
