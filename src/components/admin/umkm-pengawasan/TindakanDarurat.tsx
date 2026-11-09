'use client';

import { useEffect, useRef, useState } from 'react';
import Dialog from '@/components/ui/Dialog';
import Field from '@/components/ui/Field';
import Tombol from '@/components/ui/Tombol';
import type { MutasiDarurat, ProfilPengawasan } from '@/lib/umkm-katalog/types';
import { PengawasanError, pengawasanRequest } from './api';
import styles from './pengawasan.module.css';

export default function TindakanDarurat({ terbuka, profil, aksi, onTutup, onSaved }: {
  terbuka: boolean; profil: ProfilPengawasan; aksi: 'sembunyikan' | 'catat_pencabutan';
  onTutup: () => void; onSaved: (result: MutasiDarurat) => void;
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
    const body = { aksi, alasan: reason.trim(), expected_version: profil.versi };
    const signature = JSON.stringify([profil.id, body]);
    if (operation.current?.signature !== signature) operation.current = { signature, id: crypto.randomUUID() };
    try {
      const result = await pengawasanRequest<MutasiDarurat>(`/${profil.id}/darurat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, operasi_id: operation.current.id }),
      });
      operation.current = null;
      if (mounted.current) onSaved(result);
    } catch (e) {
      if (e instanceof PengawasanError && e.status > 0 && e.status < 500 && e.status !== 408) operation.current = null;
      if (mounted.current) setError(e instanceof PengawasanError ? e.message : 'Hasil belum pasti. Coba kembali.');
    } finally { if (mounted.current) setBusy(false); }
  };
  return <Dialog terbuka={terbuka} onTutup={onTutup} dikunci={busy}
    judul={aksi === 'sembunyikan' ? 'Sembunyikan profil' : 'Catat pencabutan izin'}>
    <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <p><strong>{profil.nama}</strong></p>
      <p>{aksi === 'sembunyikan'
        ? 'Profil berhenti tampil di katalog dan masuk ke tugas pemeriksa. Pemulihan tetap melalui pemeriksaan.'
        : 'Pencabutan izin dicatat tanpa membuka nomor UMKM. Pemeriksa akan menindaklanjutinya.'}</p>
      {error && <div ref={errorRef} role="alert" tabIndex={-1}>{error}</div>}
      <Field label="Alasan singkat" wajib bantuan="Tanpa nomor telepon, email, atau informasi kontak.">
        <textarea value={reason} required maxLength={240} disabled={busy}
          onChange={(event) => { operation.current = null; setReason(event.target.value); setError(''); }} />
      </Field>
      <div className={styles.aksi}>
        <Tombol type="submit" varian={aksi === 'sembunyikan' ? 'bahaya' : 'utama'} memuat={busy}>
          {aksi === 'sembunyikan' ? 'Sembunyikan profil' : 'Catat pencabutan'}
        </Tombol>
        <Tombol varian="hantu" onClick={onTutup} disabled={busy}>Batal</Tombol>
      </div>
    </form>
  </Dialog>;
}
