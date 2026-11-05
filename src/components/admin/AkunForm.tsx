'use client';

import { useState } from 'react';
import Dialog from '@/components/ui/Dialog';
import Field from '@/components/ui/Field';
import Tombol from '@/components/ui/Tombol';
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
  /** Fase 3: penanda Koordinator (bukan role). Tidak ada sebelum migrasi 202610290001 diterapkan. */
  koordinator?: boolean;
  /** Admin mengizinkan pemilik akun mengisi "operator harian" di Profil Saya. Tidak ada sebelum migrasi 202611030014. */
  operator_aktif?: boolean;
}

export interface LayananOption {
  id: string;
  nama: string;
}

/** Dialog akun di atas komponen Dialog bersama (fokus terjebak, Esc menutup). `kaki` = baris tombol aksi. */
export function AkunDialog({
  title, onClose, children, kaki,
}: { title: string; onClose: () => void; children: React.ReactNode; kaki?: React.ReactNode }) {
  return (
    <Dialog terbuka onTutup={onClose} judul={title} kaki={kaki} tutupDenganLatar>
      {children}
    </Dialog>
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
    // Hanya petugas punya layanan; untuk FO/admin server mengosongkannya sendiri (dan menolak bila dikirim).
    if (role === 'petugas' && (layananId || null) !== akun.layanan_id) patch.layanan_id = layananId || null;
    if (Object.keys(patch).length === 0) {
      setLocalError('Tidak ada perubahan.');
      return;
    }
    onSubmit(patch);
  };

  const msg = localError || error;
  return (
    <form onSubmit={handle} className={styles.form}>
      {msg && <p className={styles.galat} role="alert">{msg}</p>}
      <Field label="Nama" wajib>
        <input value={nama} onChange={(e) => setNama(e.target.value)} required minLength={2} maxLength={200} />
      </Field>
      <Field label="Nama pengguna" bantuan="Huruf kecil, angka, dan tanda minus (3 sampai 32 karakter). Mengubahnya mengeluarkan akun dari semua perangkat.">
        <input value={username} onChange={(e) => setUsername(e.target.value)}
          autoCapitalize="none" spellCheck={false} placeholder="mis. helpdesk-oss" />
      </Field>
      <Field label="Nomor HP">
        <input type="tel" value={noHp} onChange={(e) => setNoHp(e.target.value)} placeholder="08xxxxxxxxxx" />
      </Field>
      <Field
        label="Email notifikasi"
        bantuan={akun.email_notifikasi_tersamar
          ? `Saat ini ${akun.email_notifikasi_tersamar} (${akun.email_notifikasi_terverifikasi ? 'terverifikasi' : 'belum terverifikasi'}). Kosongkan bila tidak diubah.`
          : 'Belum diisi.'}>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder={akun.email_notifikasi_tersamar ?? 'nama@instansi.go.id'} />
      </Field>
      <Field label="Role" bantuan={isSelf ? 'Anda tidak dapat mengubah role akun sendiri.' : undefined}>
        <select value={role} disabled={isSelf} onChange={(e) => setRole(e.target.value as AkunRole)}>
          <option value="petugas">Petugas</option>
          <option value="admin">Admin</option>
          <option value="front_office">Front Office</option>
        </select>
      </Field>
      <Field label="Layanan" wajib={role === 'petugas'}>
        <select value={layananId} onChange={(e) => setLayananId(e.target.value)}>
          <option value="">{role === 'petugas' ? 'Pilih layanan' : 'Tanpa layanan'}</option>
          {layananList.map((l) => <option key={l.id} value={l.id}>{l.nama}</option>)}
        </select>
      </Field>
      <div className={styles.actions}>
        <Tombol varian="hantu" onClick={onCancel}>Batal</Tombol>
        <Tombol type="submit" memuat={saving}>Simpan</Tombol>
      </div>
    </form>
  );
}
