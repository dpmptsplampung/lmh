'use client';

import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import Field from '@/components/ui/Field';
import Tombol from '@/components/ui/Tombol';
import Kartu from '@/components/ui/Kartu';
import FotoUmkm from '@/components/umkm/FotoUmkm';
import { profilSchema, type ProfilInput } from '@/lib/umkm-katalog/schemas';
import type { Detail, Mutasi } from '@/lib/umkm-katalog/types';
import { validasiUrlFoto } from '@/lib/umkm/foto-url';
import { kompresBerkas } from '@/lib/foto/kompres';
import { unggahKeR2 } from '@/lib/storage/unggah';
import { hasilBelumPasti, kirimTugas, TugasError } from './api';
import styles from './umkm-tugas.module.css';

export default function ProfilForm({ detail, onSaved, onCancel }: { detail?: Detail; onSaved: (result: Mutasi) => void; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<NonNullable<ProfilInput['foto']>>(() =>
    detail?.foto.map(({ asal, url, r2_key }) => ({ asal, url, r2_key })) ?? []);
  const operation = useRef<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const number = useRef<HTMLInputElement>(null);
  const removedPhoto = useRef<number | null>(null);
  const uploadRequest = useRef(0);
  const mounted = useRef(true);
  const rev = detail?.revisi;
  const mandiri = detail?.sumber === 'mandiri';
  useLayoutEffect(() => {
    mounted.current = true;
    form.current?.querySelector<HTMLElement>('select, input')?.focus();
    const input = number.current;
    const clear = () => { if (input) input.value = ''; operation.current = null; };
    window.addEventListener('pagehide', clear);
    return () => { mounted.current = false; clear(); window.removeEventListener('pagehide', clear); };
  }, []);

  useLayoutEffect(() => {
    if (removedPhoto.current === null) return;
    const index = removedPhoto.current;
    removedPhoto.current = null;
    const buttons = form.current?.querySelectorAll<HTMLButtonElement>('[aria-label^="Keluarkan foto "]');
    const target = buttons?.[Math.min(index, photos.length - 1)]
      ?? form.current?.querySelector<HTMLInputElement>('[name="foto_url"]');
    target?.focus();
  }, [photos]);

  const upload = async (file?: File) => {
    if (!file) return;
    const current = photos;
    if (current.length >= 10) { setError('Maksimal 10 foto per profil.'); return; }
    const generation = ++uploadRequest.current;
    setUploading(true); setError('');
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Pilih foto JPEG, PNG, atau WebP.');
      const blob = await kompresBerkas(file);
      if (!mounted.current || generation !== uploadRequest.current) return;
      if (blob.size > 2 * 1024 * 1024) throw new Error('Foto masih terlalu besar. Pilih foto lain.');
      const path = `${crypto.randomUUID()}.jpg`;
      const result = await unggahKeR2('umkm-draf', path, blob);
      if (!mounted.current || generation !== uploadRequest.current) return;
      operation.current = null;
      setPhotos([...current, { asal: 'unggahan', r2_key: result.kunci }]);
    } catch (e) {
      if (mounted.current && generation === uploadRequest.current) setError(e instanceof Error ? e.message : 'Foto belum berhasil diunggah.');
    } finally {
      if (mounted.current && generation === uploadRequest.current) setUploading(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || uploading) return;
    setError(''); setErrors({});
    const data = new FormData(event.currentTarget);
    const value = (key: string) => String(data.get(key) ?? '').trim();
    // Profil mandiri dikirim sebagai 'kurasi'. Basis data mempertahankan sumber mandiri dan pendaftarnya.
    const source = mandiri ? 'kurasi' : value('sumber');
    const payload: Record<string, unknown> = {
      nama: value('nama'), deskripsi: value('deskripsi'), alamat: value('alamat') || null,
      jenis: value('jenis'), kategori: value('kategori'), spesifik: value('spesifik') || null,
      kabupaten_kota: value('kabupaten_kota'), memiliki_nib: value('nib') === '' ? null : value('nib') === 'ya',
      instagram: value('instagram') || null, tiktok: value('tiktok') || null,
      sumber: source, sumber_ref: detail?.sumber_ref ?? null,
    };
    if (value('nomor')) payload.nomor = value('nomor');
    payload.foto = photos;
    const photoUrl = value('foto_url');
    if (photoUrl) {
      const checked = validasiUrlFoto(photoUrl);
      if (!checked.ok) { setErrors({ foto: checked.alasan }); return; }
      payload.foto = [...photos, { asal: source === 'satudata' ? 'satudata' : 'eksternal', url: checked.url }];
    }
    const parsed = profilSchema.safeParse(payload);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = 'Periksa isian ini dan batas panjangnya.';
      setErrors(fieldErrors); setError('Data belum lengkap atau formatnya belum sesuai.');
      return;
    }
    setBusy(true);
    operation.current ??= crypto.randomUUID();
    try {
      const result = await kirimTugas<Mutasi>('', { data: parsed.data, operasi_id: operation.current,
        ...(detail ? { profil_id: detail.id, expected_version: detail.versi } : {}) });
      operation.current = null;
      if (number.current) number.current.value = '';
      if (mounted.current) onSaved(result);
    } catch (e) {
      if (!hasilBelumPasti(e)) operation.current = null;
      if (mounted.current) setError(e instanceof TugasError ? e.message : 'Profil belum berhasil disimpan.');
    } finally { if (mounted.current) setBusy(false); }
  };

  const warning = (key: string) => errors[key] || (detail?.peringatan_kontak.includes(key) ? 'Informasi kontak ditemukan. Bersihkan bagian ini sebelum menerbitkan.' : undefined);
  return <Kartu judul={detail ? 'Perbaiki profil' : 'Tambah profil'}>
    <form ref={form} onSubmit={submit} onChange={() => { operation.current = null; }}
      className={styles.form} autoComplete="off">
      {error && <p role="alert" className={styles.galat}>{error}</p>}
      <div className={styles.bidang}>
        {mandiri
          ? <p className={styles.lebar}>Sumber: didaftarkan pemilik</p>
          : <Field label="Sumber data"><select name="sumber" defaultValue={detail?.sumber ?? 'kurasi'}><option value="kurasi">Data kurasi</option><option value="satudata">Satudata</option><option value="loket">Tamu loket</option></select></Field>}
        <Field label="Nama usaha" galat={warning('nama')}><input name="nama" defaultValue={rev?.nama} maxLength={200} /></Field>
        <Field label="Jenis" galat={warning('jenis')}><input name="jenis" defaultValue={rev?.jenis} maxLength={100} /></Field>
        <Field label="Kategori" galat={warning('kategori')}><input name="kategori" defaultValue={rev?.kategori} maxLength={100} /></Field>
        <Field label="Spesifik (opsional)" galat={warning('spesifik')}><input name="spesifik" defaultValue={rev?.spesifik ?? ''} maxLength={100} /></Field>
        <Field label="Kabupaten/kota" galat={warning('kabupaten_kota')}><input name="kabupaten_kota" defaultValue={rev?.kabupaten_kota} maxLength={100} /></Field>
        <Field label="Deskripsi" galat={warning('deskripsi')} className={styles.lebar}><textarea name="deskripsi" defaultValue={rev?.deskripsi} maxLength={4000} /></Field>
        <Field label="Alamat (privat)" galat={warning('alamat')} className={styles.lebar}><input name="alamat" defaultValue={rev?.alamat ?? ''} maxLength={500} /></Field>
        <Field label="Memiliki NIB (opsional)" bantuan="Tidak menghalangi penerbitan."><select name="nib" defaultValue={rev?.memiliki_nib == null ? '' : rev.memiliki_nib ? 'ya' : 'tidak'}><option value="">Belum diketahui</option><option value="ya">Ya</option><option value="tidak">Tidak</option></select></Field>
        <Field label={detail ? 'Ganti nomor WhatsApp (opsional)' : 'Nomor WhatsApp (opsional)'} galat={warning('nomor')} bantuan={detail ? 'Kosongkan untuk mempertahankan nomor. Nomor baru membatalkan izin lama.' : 'Tanpa nomor tetap dapat diterbitkan.'}><input ref={number} type="tel" name="nomor" inputMode="tel" maxLength={21} autoComplete="off" /></Field>
        <Field label="Instagram (opsional)" galat={warning('instagram')}><input name="instagram" type="url" defaultValue={rev?.instagram ?? ''} maxLength={500} placeholder="https://www.instagram.com/namausaha" /></Field>
        <Field label="TikTok (opsional)" galat={warning('tiktok')}><input name="tiktok" type="url" defaultValue={rev?.tiktok ?? ''} maxLength={500} placeholder="https://www.tiktok.com/@namausaha" /></Field>
        <Field label="Tambah tautan foto HTTPS" galat={warning('foto')} bantuan="Foto satudata tetap berupa tautan. Foto baru diperiksa kembali."><input name="foto_url" type="url" maxLength={500} /></Field>
        <Field label="Unggah foto" bantuan="JPEG, PNG, atau WebP. Foto disimpan privat sebelum diperiksa."><input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading || busy} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} /></Field>
      </div>
      {uploading && <p role="status">Mengunggah foto...</p>}
      <section className={styles.bagian} aria-label="Foto revisi baru">
        <h3>Foto untuk diperiksa</h3>
        <p role="status">{photos.length} foto disiapkan untuk pemeriksaan.</p>
        {photos.length === 0 ? <p>Belum ada foto yang disiapkan.</p> : <div className={styles.foto}>
          {photos.map((photo, index) => {
            const previous = detail?.foto.find((f) => f.url === photo.url && f.r2_key === photo.r2_key);
            const preview = photo.asal === 'unggahan'
              ? previous && `/api/admin/umkm-tugas/${detail!.id}/foto/${previous.id}` : photo.url;
            return <figure key={`${photo.url ?? photo.r2_key}:${index}`}>
              {preview ? <FotoUmkm src={preview} alt={`Foto ${index + 1} untuk diperiksa`}
                width={240} height={180} style={{ width: '100%', maxWidth: '100%' }} />
                : <p>Foto unggahan privat {index + 1}</p>}
              <figcaption>Foto {index + 1}{previous?.tersembunyi ? ', disembunyikan' : ''}</figcaption>
              <Tombol varian="sekunder" disabled={busy || uploading} aria-label={`Keluarkan foto ${index + 1}`}
                onClick={() => {
                  operation.current = null;
                  removedPhoto.current = index;
                  setPhotos((current) => current.filter((_, i) => i !== index));
                }}>Keluarkan</Tombol>
            </figure>;
          })}
        </div>}
      </section>
      <div className={styles.aksi}><Tombol type="submit" memuat={busy} disabled={uploading}>Simpan untuk diperiksa</Tombol><Tombol varian="hantu" onClick={onCancel} disabled={busy}>Batal</Tombol></div>
    </form>
  </Kartu>;
}
