'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import styles from './AkunForm.module.css';

export type AkunRole = 'admin' | 'petugas' | 'front_office';

export interface AkunRow {
  id: string;
  nama: string;
  username: string | null;
  role: AkunRole;
  layanan_id: string | null;
  layanan_nama: string | null;
  no_hp: string | null;
  aktif: boolean;
  nonaktif_alasan?: string | null;
  email_notifikasi_tersamar: string | null;
  email_notifikasi_terverifikasi: boolean;
  last_sign_in_at: string | null;
  belum_pernah_login: boolean;
}

export interface LayananOption {
  id: string;
  nama: string;
}

/** Dialog modal sederhana: Esc menutup, fokus awal ke dialog, klik latar menutup. */
export function AkunDialog({
  title, onClose, children,
}: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={styles.dialog}>
        <div className={styles.dialogHead}>
          <h2 className={styles.dialogTitle}>{title}</h2>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Tutup">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Form ubah akun (Admin). Hanya mengirim field yang berubah ke PATCH /api/admin/petugas/{id}.
 * Role tidak bisa diubah pada akun sendiri (server juga menolak).
 */
export default function AkunForm({
  akun, layananList, isSelf, saving, error, onSubmit, onCancel,
}: {
  akun: AkunRow;
  layananList: LayananOption[];
  isSelf: boolean;
  saving: boolean;
  error: string;
  onSubmit: (patch: Record<string, string | null>) => void;
  onCancel: () => void;
}) {
  const [nama, setNama] = useState(akun.nama);
  const [username, setUsername] = useState(akun.username ?? '');
  const [noHp, setNoHp] = useState(akun.no_hp ?? '');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AkunRole>(akun.role);
  const [layananId, setLayananId] = useState(akun.layanan_id ?? '');
  const [localError, setLocalError] = useState('');

  const handle = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');
    if (role === 'petugas' && !layananId) {
      setLocalError('Petugas wajib memiliki layanan.');
      return;
    }
    const patch: Record<string, string | null> = {};
    if (nama.trim() !== akun.nama) patch.nama = nama.trim();
    if (username.trim() !== (akun.username ?? '')) patch.username = username.trim().toLowerCase();
    if (noHp.trim() !== (akun.no_hp ?? '')) patch.no_hp = noHp.trim() || null;
    if (email.trim()) patch.email_notifikasi = email.trim();
    if (!isSelf && role !== akun.role) patch.role = role;
    if ((layananId || null) !== akun.layanan_id) patch.layanan_id = layananId || null;
    if (Object.keys(patch).length === 0) {
      setLocalError('Tidak ada perubahan.');
      return;
    }
    onSubmit(patch);
  };

  const msg = localError || error;
  return (
    <form onSubmit={handle} className={styles.form}>
      {msg && <p className="form-error" role="alert">{msg}</p>}
      <div className="form-group">
        <label className="form-label form-label--required" htmlFor="akunNama">Nama</label>
        <input id="akunNama" className="form-input" value={nama} onChange={(e) => setNama(e.target.value)} required minLength={2} maxLength={200} />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="akunUsername">Nama pengguna</label>
        <input id="akunUsername" className="form-input" value={username} onChange={(e) => setUsername(e.target.value)}
          autoCapitalize="none" spellCheck={false} placeholder="mis. helpdesk-oss" />
        <p className={styles.hint}>Huruf kecil, angka, dan tanda minus (3-32). Mengubahnya mengeluarkan akun dari semua perangkat.</p>
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="akunHp">Nomor HP</label>
        <input id="akunHp" type="tel" className="form-input" value={noHp} onChange={(e) => setNoHp(e.target.value)} placeholder="08xxxxxxxxxx" />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="akunEmail">Email notifikasi</label>
        <input id="akunEmail" type="email" className="form-input" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder={akun.email_notifikasi_tersamar ?? 'nama@instansi.go.id'} />
        <p className={styles.hint}>
          {akun.email_notifikasi_tersamar
            ? `Saat ini ${akun.email_notifikasi_tersamar} (${akun.email_notifikasi_terverifikasi ? 'terverifikasi' : 'belum terverifikasi'}). Kosongkan bila tidak diubah.`
            : 'Belum diisi.'}
        </p>
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="akunRole">Role</label>
        <select id="akunRole" className="form-input" value={role} disabled={isSelf}
          onChange={(e) => setRole(e.target.value as AkunRole)}>
          <option value="petugas">Petugas</option>
          <option value="admin">Admin</option>
          <option value="front_office">Front Office</option>
        </select>
        {isSelf && <p className={styles.hint}>Anda tidak dapat mengubah role akun sendiri.</p>}
      </div>
      <div className="form-group">
        <label className={`form-label ${role === 'petugas' ? 'form-label--required' : ''}`} htmlFor="akunLayanan">Layanan</label>
        <select id="akunLayanan" className="form-input" value={layananId} onChange={(e) => setLayananId(e.target.value)}>
          <option value="">{role === 'petugas' ? '— Pilih layanan —' : '— Tanpa layanan —'}</option>
          {layananList.map((l) => <option key={l.id} value={l.id}>{l.nama}</option>)}
        </select>
      </div>
      <div className={styles.actions}>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>Batal</button>
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? <Loader2 size={16} className="animate-pulse" /> : null} Simpan
        </button>
      </div>
    </form>
  );
}
