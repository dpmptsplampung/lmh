'use client';

import { useState } from 'react';
import Field from '@/components/ui/Field';
import Tombol from '@/components/ui/Tombol';
import type { StatusStatistik } from '@/lib/umkm-katalog/types';
import { LaporanError, laporanRequest } from './api';
import styles from './laporan.module.css';

export default function SakelarStatistik({ status, onSimpan }: {
  status: StatusStatistik; onSimpan: () => void;
}) {
  const [version, setVersion] = useState(status.versi_naskah ?? '');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const save = async () => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await laporanRequest<StatusStatistik>('', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aktif: !status.telemetri_opsional_aktif, versi_naskah: version.trim(), kebijakan_terbit: confirmed,
        }),
      });
      setNotice('Pengaturan pencatatan disimpan.'); onSimpan();
    } catch (e) {
      setError(e instanceof LaporanError ? e.message : 'Pengaturan belum tersimpan. Silakan coba lagi.');
    } finally { setBusy(false); }
  };
  return <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <p>Pencatatan opsional {status.telemetri_opsional_aktif ? 'aktif' : 'mati'}.</p>
    <p>Tampilan profil, klik membuka formulir, dan pencarian tanpa hasil hanya dicatat saat sakelar aktif.</p>
    <Field label="Versi naskah kebijakan" wajib={!status.telemetri_opsional_aktif}>
      <input value={version} maxLength={100} required={!status.telemetri_opsional_aktif} disabled={busy}
        onChange={(event) => setVersion(event.target.value)} />
    </Field>
    <label className={styles.konfirmasi}>
      <input type="checkbox" checked={confirmed} disabled={busy} required={!status.telemetri_opsional_aktif}
        onChange={(event) => setConfirmed(event.target.checked)} />
      Saya memastikan kebijakan privasi sudah terbit.
    </label>
    <a href="/kebijakan-privasi" target="_blank" rel="noopener noreferrer">Baca kebijakan privasi (tab baru)</a>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className={styles.aksi}>
      <Tombol type="submit" memuat={busy}
        disabled={!status.telemetri_opsional_aktif && (!confirmed || !version.trim())}>
        {status.telemetri_opsional_aktif ? 'Matikan pencatatan opsional' : 'Aktifkan pencatatan opsional'}
      </Tombol>
    </div>
  </form>;
}
