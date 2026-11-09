'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Dialog from '@/components/ui/Dialog';
import Field from '@/components/ui/Field';
import Tombol from '@/components/ui/Tombol';
import { KatalogError, kirimFormulir } from './api';
import styles from './katalog.module.css';
import { ALASAN_LAPORAN } from './alasan';

export type KonteksFormulir = { profil_id?: string; nama?: string; kata_kunci?: string; foto_id?: string };
export default function FormulirKatalog({ terbuka, jenis, konteks, onTutup }: {
  terbuka: boolean; jenis: 'pesan' | 'laporan'; konteks: KonteksFormulir; onTutup: () => void;
}) {
  const [values, setValues] = useState({ nama: '', perusahaan: '', nomor: '', pesan: '', alasan: '', catatan: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<string | null>(null);
  const operation = useRef<{ signature: string; id: string } | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  const close = () => {
    if (receipt) {
      setReceipt(null);
      setValues({ nama: '', perusahaan: '', nomor: '', pesan: '', alasan: '', catatan: '' });
      setError('');
      operation.current = null;
    }
    onTutup();
  };
  const change = (key: keyof typeof values, value: string) => {
    operation.current = null; setError(''); setValues((previous) => ({ ...previous, [key]: value }));
  };
  const submit = async () => {
    if (busy) return;
    setBusy(true); setError('');
    const context = {
      ...(konteks.profil_id ? { profil_id: konteks.profil_id } : {}),
      ...(jenis === 'pesan' && konteks.kata_kunci ? { kata_kunci: konteks.kata_kunci } : {}),
    };
    const body = jenis === 'pesan' ? {
      ...context, nama: values.nama.trim(), perusahaan: values.perusahaan.trim(),
      nomor: values.nomor.trim(), pesan: values.pesan.trim(),
    } : {
      ...context, alasan: values.alasan,
      ...(konteks.foto_id ? { foto_id: konteks.foto_id } : {}),
      ...(values.catatan.trim() ? { catatan: values.catatan.trim() } : {}),
    };
    const signature = JSON.stringify([jenis, body]);
    if (operation.current?.signature !== signature) operation.current = { signature, id: crypto.randomUUID() };
    try {
      const result = await kirimFormulir(jenis === 'pesan' ? '/pesan' : '/laporan', {
        ...body, operasi_id: operation.current.id,
      });
      operation.current = null;
      if (mounted.current) setReceipt(result.id);
    } catch (e) {
      if (e instanceof KatalogError && e.status > 0 && e.status < 500 && e.status !== 408) operation.current = null;
      if (mounted.current) setError(e instanceof KatalogError ? e.message : 'Pengiriman belum pasti. Coba kirim kembali.');
    } finally { if (mounted.current) setBusy(false); }
  };

  return <Dialog terbuka={terbuka} onTutup={close} dikunci={busy}
    judul={jenis === 'pesan' ? 'Hubungi lewat petugas' : 'Laporkan'}>
    {receipt ? <div className={styles.form}>
      <p role="status">{jenis === 'pesan'
        ? 'Pesan diterima. Petugas akan menghubungi Anda melalui kontak yang Anda isi.'
        : 'Laporan diterima. Petugas akan memeriksanya.'}</p>
      <Tombol onClick={close}>Selesai</Tombol>
    </div> : <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <p className={styles.keterangan}>
        {konteks.nama ? `Terkait profil: ${konteks.nama}. ` : ''}
        {konteks.kata_kunci ? `Kata kunci terlampir: ${konteks.kata_kunci}. ` : ''}
        {konteks.foto_id ? 'Foto yang Anda pilih ikut terlampir.' : 'Konteks halaman ikut terkirim.'}
      </p>
      <p className={styles.pemberitahuan}>
        {jenis === 'pesan' ? 'Data Anda dipakai petugas untuk membalas melalui WhatsApp pribadi.'
          : 'Alasan dan catatan dipakai petugas untuk memeriksa laporan.'}{' '}
        Data disimpan paling lama 180 hari setelah ditangani, atau sejak aktivitas terakhir bila belum ditangani.{' '}
        <Link href="/kebijakan-privasi" target="_blank" rel="noopener noreferrer">Kebijakan Privasi</Link>.
      </p>
      {error && <div ref={errorRef} role="alert" tabIndex={-1} className={styles.galat}>{error}</div>}
      <fieldset disabled={busy} className={styles.form}>
        <legend className="sr-only">{jenis === 'pesan' ? 'Isian pesan' : 'Isian laporan'}</legend>
        {jenis === 'pesan' ? <>
          <Field label="Nama Anda" wajib><input autoComplete="name" value={values.nama} maxLength={200} required
            onChange={(event) => change('nama', event.target.value)} /></Field>
          <Field label="Perusahaan" wajib><input autoComplete="organization" value={values.perusahaan}
            maxLength={200} required onChange={(event) => change('perusahaan', event.target.value)} /></Field>
          <Field label="Nomor kontak" wajib bantuan="Gunakan nomor WhatsApp yang dapat dihubungi petugas.">
            <input type="tel" inputMode="tel" autoComplete="tel" value={values.nomor} minLength={8} maxLength={20}
              required onChange={(event) => change('nomor', event.target.value)} />
          </Field>
          <Field label="Pesan" wajib><textarea value={values.pesan} maxLength={1000} required
            onChange={(event) => change('pesan', event.target.value)} /></Field>
        </> : <>
          <Field label="Alasan laporan" wajib><select value={values.alasan} required
            onChange={(event) => change('alasan', event.target.value)}>
            <option value="">Pilih alasan</option>
            {Object.entries(ALASAN_LAPORAN).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></Field>
          <Field label="Catatan (opsional)"><textarea value={values.catatan} maxLength={500}
            onChange={(event) => change('catatan', event.target.value)} /></Field>
        </>}
      </fieldset>
      <div className={styles.aksi}>
        <Tombol type="submit" memuat={busy}>{jenis === 'pesan' ? 'Kirim pesan' : 'Kirim laporan'}</Tombol>
        <Tombol varian="hantu" onClick={close} disabled={busy}>Batal</Tombol>
      </div>
    </form>}
  </Dialog>;
}
