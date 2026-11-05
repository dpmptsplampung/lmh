'use client';

import { useState } from 'react';
import Field from '@/components/ui/Field';
import Tombol from '@/components/ui/Tombol';
import type { AkunRole, LayananOption } from './AkunForm';
import styles from './AkunForm.module.css';

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
      setLocalError('Nama pengguna 3 sampai 32 karakter: huruf kecil, angka, tanda minus.');
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
    if (sandi && (sandi.length < 8 || sandi.length > 72)) {
      setLocalError('Sandi sementara 8 sampai 72 karakter, atau kosongkan agar dibuatkan otomatis.');
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
    <form onSubmit={handle} className={styles.form}>
      {msg && <p className={styles.galat} role="alert">{msg}</p>}
      <Field label="Nama" wajib>
        <input value={nama} maxLength={200} onChange={(e) => setNama(e.target.value)} />
      </Field>
      <Field label="Nama pengguna" wajib bantuan="Huruf kecil, angka, dan tanda minus (3 sampai 32 karakter). Dipakai untuk masuk.">
        <input value={username} autoCapitalize="none" spellCheck={false}
          onChange={(e) => setUsername(e.target.value.toLowerCase())} placeholder="mis. helpdesk-oss" />
      </Field>
      <Field label="Role">
        <select value={role} onChange={(e) => setRole(e.target.value as AkunRole)}>
          <option value="petugas">Petugas (akun layanan)</option>
          <option value="front_office">Front Office</option>
          <option value="admin">Admin</option>
        </select>
      </Field>
      {role === 'petugas' && (
        <Field label="Layanan" wajib>
          <select value={layananId} onChange={(e) => setLayananId(e.target.value)}>
            <option value="">Pilih layanan</option>
            {layananList.map((l) => <option key={l.id} value={l.id}>{l.nama}</option>)}
          </select>
        </Field>
      )}
      <Field label="Nomor HP">
        <input type="tel" value={noHp} onChange={(e) => setNoHp(e.target.value)} placeholder="08xxxxxxxxxx" />
      </Field>
      <Field label="Sandi sementara (opsional)" bantuan="Kosongkan agar sistem membuatkan. Pengguna wajib menggantinya saat masuk pertama kali.">
        <input value={sandi} autoComplete="off" onChange={(e) => setSandi(e.target.value)} />
      </Field>
      <div className={styles.actions}>
        <Tombol varian="hantu" onClick={onCancel}>Batal</Tombol>
        <Tombol type="submit" memuat={saving}>Buat akun</Tombol>
      </div>
    </form>
  );
}
