'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { AkunRole, LayananOption } from './AkunForm';

export interface AkunBaruInput {
  username: string;
  nama: string;
  role: AkunRole;
  layanan_id?: string;
  no_hp?: string;
  sandi_sementara?: string;
}

/** Form "Buat Akun Layanan" (Admin). Sandi sementara boleh kosong: server membuatkan. */
export default function AkunBaruForm({
  layananList, saving, error, onSubmit, onCancel,
}: {
  layananList: LayananOption[];
  saving: boolean;
  error: string;
  onSubmit: (data: AkunBaruInput) => void;
  onCancel: () => void;
}) {
  const [username, setUsername] = useState('');
  const [nama, setNama] = useState('');
  const [role, setRole] = useState<AkunRole>('petugas');
  const [layananId, setLayananId] = useState('');
  const [noHp, setNoHp] = useState('');
  const [sandi, setSandi] = useState('');
  const [localError, setLocalError] = useState('');

  const handle = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');
    if (!/^[a-z0-9-]{3,32}$/.test(username.trim())) {
      setLocalError('Nama pengguna 3-32 karakter: huruf kecil, angka, tanda minus.');
      return;
    }
    if (nama.trim().length < 2) {
      setLocalError('Nama minimal 2 karakter.');
      return;
    }
    if (role === 'petugas' && !layananId) {
      setLocalError('Petugas wajib memiliki layanan.');
      return;
    }
    if (sandi && (sandi.length < 10 || sandi.length > 72)) {
      setLocalError('Sandi sementara 10 sampai 72 karakter, atau kosongkan agar dibuatkan otomatis.');
      return;
    }
    onSubmit({
      username: username.trim(),
      nama: nama.trim(),
      role,
      ...(role === 'petugas' && { layanan_id: layananId }),
      ...(noHp.trim() && { no_hp: noHp.trim() }),
      ...(sandi && { sandi_sementara: sandi }),
    });
  };

  const msg = localError || error;
  return (
    <form onSubmit={handle} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {msg && <p className="form-error" role="alert">{msg}</p>}
      <div className="form-group">
        <label className="form-label form-label--required" htmlFor="baruNama">Nama</label>
        <input id="baruNama" className="form-input" value={nama} maxLength={200} onChange={(e) => setNama(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label form-label--required" htmlFor="baruUsername">Nama pengguna</label>
        <input id="baruUsername" className="form-input" value={username} autoCapitalize="none" spellCheck={false}
          placeholder="mis. helpdesk-oss" onChange={(e) => setUsername(e.target.value.toLowerCase())} />
        <p className="form-hint">Huruf kecil, angka, dan tanda minus (3-32). Dipakai untuk masuk.</p>
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="baruRole">Role</label>
        <select id="baruRole" className="form-input" value={role} onChange={(e) => setRole(e.target.value as AkunRole)}>
          <option value="petugas">Petugas (akun layanan)</option>
          <option value="front_office">Front Office</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      {role === 'petugas' && (
        <div className="form-group">
          <label className="form-label form-label--required" htmlFor="baruLayanan">Layanan</label>
          <select id="baruLayanan" className="form-input" value={layananId} onChange={(e) => setLayananId(e.target.value)}>
            <option value="">— Pilih layanan —</option>
            {layananList.map((l) => <option key={l.id} value={l.id}>{l.nama}</option>)}
          </select>
        </div>
      )}
      <div className="form-group">
        <label className="form-label" htmlFor="baruHp">Nomor HP</label>
        <input id="baruHp" type="tel" className="form-input" value={noHp} onChange={(e) => setNoHp(e.target.value)} placeholder="08xxxxxxxxxx" />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="baruSandi">Sandi sementara (opsional)</label>
        <input id="baruSandi" className="form-input" value={sandi} autoComplete="off" onChange={(e) => setSandi(e.target.value)} />
        <p className="form-hint">Kosongkan agar sistem membuatkan. Pengguna wajib menggantinya saat masuk pertama kali.</p>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>Batal</button>
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? <Loader2 size={16} className="animate-pulse" /> : null} Buat akun
        </button>
      </div>
    </form>
  );
}
