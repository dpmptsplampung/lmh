'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

export interface TamuInput {
  nama: string;
  bertemu: string;
  instansi?: string;
  tujuan?: string;
  no_hp?: string;
}

/** Form catat tamu kantor (Admin + Front Office). onSubmit melempar Error bila gagal. */
export default function TamuForm({ onSubmit }: { onSubmit: (data: TamuInput) => Promise<void> }) {
  const [nama, setNama] = useState('');
  const [instansi, setInstansi] = useState('');
  const [tujuan, setTujuan] = useState('');
  const [bertemu, setBertemu] = useState('');
  const [noHp, setNoHp] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (nama.trim().length < 2 || bertemu.trim().length < 2) {
      setError('Nama tamu dan nama yang ditemui minimal 2 karakter.');
      return;
    }
    setSaving(true);
    try {
      await onSubmit({
        nama: nama.trim(),
        bertemu: bertemu.trim(),
        ...(instansi.trim() && { instansi: instansi.trim() }),
        ...(tujuan.trim() && { tujuan: tujuan.trim() }),
        ...(noHp.trim() && { no_hp: noHp.trim() }),
      });
      setNama(''); setInstansi(''); setTujuan(''); setBertemu(''); setNoHp('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mencatat tamu');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handle} aria-label="Catat tamu"
      style={{ display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginBottom: 'var(--space-6)' }}>
      {error && <p className="form-error" role="alert" style={{ gridColumn: '1 / -1' }}>{error}</p>}
      <div className="form-group">
        <label className="form-label form-label--required" htmlFor="tamuNama">Nama tamu</label>
        <input id="tamuNama" className="form-input" value={nama} maxLength={200} onChange={(e) => setNama(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="tamuInstansi">Instansi / asal</label>
        <input id="tamuInstansi" className="form-input" value={instansi} maxLength={200} onChange={(e) => setInstansi(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label form-label--required" htmlFor="tamuBertemu">Bertemu siapa</label>
        <input id="tamuBertemu" className="form-input" value={bertemu} maxLength={200} onChange={(e) => setBertemu(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="tamuTujuan">Tujuan</label>
        <input id="tamuTujuan" className="form-input" value={tujuan} maxLength={500} onChange={(e) => setTujuan(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="tamuHp">Nomor HP (opsional)</label>
        <input id="tamuHp" type="tel" className="form-input" value={noHp} onChange={(e) => setNoHp(e.target.value)} placeholder="08xxxxxxxxxx" />
      </div>
      <div style={{ alignSelf: 'end' }}>
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? <Loader2 size={16} className="animate-pulse" /> : null} Catat tamu
        </button>
      </div>
    </form>
  );
}
