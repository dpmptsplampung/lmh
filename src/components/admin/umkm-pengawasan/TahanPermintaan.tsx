'use client';

import { useEffect, useRef, useState } from 'react';
import Dialog from '@/components/ui/Dialog';
import Field from '@/components/ui/Field';
import Tombol from '@/components/ui/Tombol';
import { PengawasanError, pengawasanRequest } from './api';
import type { RujukanPermintaan } from './permintaan-types';
import styles from './pengawasan.module.css';

// Tahan darurat: hanya id, versi, dan alasan singkat. Layar ini tidak pernah memegang data pemohon.
export default function TahanPermintaan({ terbuka, permintaan, onTutup, onSaved }: {
  terbuka: boolean; permintaan: RujukanPermintaan; onTutup: () => void; onSaved: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const operation = useRef<{ signature: string; id: string } | null>(null);
  const mounted = useRef(true);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const submit = async () => {
    if (busy || !reason.trim()) return;
    setBusy(true); setError('');
    const body = { alasan: reason.trim(), expected_version: permintaan.versi };
    const signature = JSON.stringify([permintaan.id, body]);
    if (operation.current?.signature !== signature) operation.current = { signature, id: crypto.randomUUID() };
    try {
      await pengawasanRequest(`/permintaan/${permintaan.id}/tahan`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, operasi_id: operation.current.id }),
      });
      operation.current = null;
      if (mounted.current) onSaved();
    } catch (e) {
      const pasti = e instanceof PengawasanError && e.status > 0 && e.status < 500 && e.status !== 408;
      if (pasti) operation.current = null;
      if (mounted.current) setError(e instanceof PengawasanError
        ? (e.code === 'KONFLIK_VERSI' || e.code === 'KONFLIK_STATUS' || e.code === 'KONFLIK_OPERASI'
          ? 'Permintaan sudah berubah. Muat ulang jejak lalu coba lagi.' : e.message)
        : 'Hasil belum pasti. Coba kembali.');
    } finally { if (mounted.current) setBusy(false); }
  };
  return <Dialog terbuka={terbuka} onTutup={onTutup} dikunci={busy} judul="Tahan permintaan">
    <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <p><strong>Permintaan {permintaan.kode ?? ''}</strong></p>
      <p>Nomor tidak bisa dibuka atau dibaca sampai pemeriksa UMKM melepas tahan.
        Permintaan masuk antrean sebagai mendesak.</p>
      {error && <div ref={errorRef} role="alert" tabIndex={-1}>{error}</div>}
      <Field label="Alasan singkat" wajib bantuan="Tanpa nomor telepon, email, atau informasi kontak.">
        <textarea value={reason} required maxLength={240} disabled={busy}
          onChange={(event) => { operation.current = null; setReason(event.target.value); setError(''); }} />
      </Field>
      <div className={styles.aksi}>
        <Tombol type="submit" varian="bahaya" memuat={busy}>Tahan permintaan</Tombol>
        <Tombol varian="hantu" onClick={onTutup} disabled={busy}>Batal</Tombol>
      </div>
    </form>
  </Dialog>;
}
