'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Field from '@/components/ui/Field';
import Kartu from '@/components/ui/Kartu';
import Tombol from '@/components/ui/Tombol';
import FotoUmkm from '@/components/umkm/FotoUmkm';
import { kompresBerkas } from '@/lib/foto/kompres';
import { unggahKeR2 } from '@/lib/storage/unggah';
import { profilSchema } from '@/lib/umkm-katalog/schemas';
import { validasiUrlFoto } from '@/lib/umkm/foto-url';
import { PemilikError, hasilBelumPasti, kirimPemilik } from './api';
import type { DetailUsaha, MutasiPemilik } from '@/lib/umkm-katalog/types-g5';
import styles from './pemilik.module.css';

// Pemilik tidak memilih atau mengirim sumber data: server menetapkannya (mandiri).
const dataPemilikSchema = profilSchema.omit({ sumber: true, sumber_ref: true });
type FotoDraf = NonNullable<ReturnType<typeof dataPemilikSchema.parse>['foto']>;

function pesanSimpan(e: PemilikError, draf: boolean, detail?: DetailUsaha): string {
  if (draf && e.code === 'KONFLIK_STATUS' && detail?.status === 'disembunyikan') {
    return 'Profil sedang disembunyikan petugas. Perubahan bisa dikirim lagi sesudah petugas memulihkannya.';
  }
  return e.message;
}

type Props = { mode: 'daftar' | 'draf'; detail?: DetailUsaha; onSelesai: (hasil: MutasiPemilik) => void; onBatal: () => void };

// Formulir sama dengan formulir profil petugas, tanpa sumber data dan tanpa tindakan menerbitkan.
// Mode draf: foto boleh diunggah ke area draf pribadi; versi lama tetap tampil sampai petugas memeriksa.
export default function FormUsaha({ mode, detail, onSelesai, onBatal }: Props) {
  const rev = detail?.revisi ?? null;
  const draf = mode === 'draf';
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<FotoDraf>(() =>
    detail?.foto.map(({ asal, url, r2_key }) => ({ asal, url, r2_key })) ?? []);
  const operation = useRef<string | null>(null);
  const number = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const input = number.current;
    const clear = () => { if (input) input.value = ''; operation.current = null; };
    window.addEventListener('pagehide', clear);
    return () => { mounted.current = false; clear(); window.removeEventListener('pagehide', clear); };
  }, []);

  const upload = async (file?: File) => {
    if (!file || !detail) return;
    if (photos.length >= 10) { setError('Maksimal 10 foto per profil.'); return; }
    setUploading(true); setError('');
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Pilih foto JPEG, PNG, atau WebP.');
      const blob = await kompresBerkas(file);
      if (blob.size > 2 * 1024 * 1024) throw new Error('Foto masih terlalu besar. Pilih foto lain.');
      const hasil = await unggahKeR2('umkm-draf', `${detail.id}/${crypto.randomUUID()}.jpg`, blob);
      if (!mounted.current) return;
      operation.current = null;
      setPhotos((lama) => [...lama, { asal: 'unggahan', r2_key: hasil.kunci }]);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : 'Foto belum berhasil diunggah.');
    } finally { if (mounted.current) setUploading(false); }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || uploading) return;
    setError(''); setErrors({});
    const data = new FormData(event.currentTarget);
    const value = (key: string) => String(data.get(key) ?? '').trim();
    const payload: Record<string, unknown> = {
      nama: value('nama'), deskripsi: value('deskripsi'), alamat: value('alamat') || null,
      jenis: value('jenis'), kategori: value('kategori'), spesifik: value('spesifik') || null,
      kabupaten_kota: value('kabupaten_kota'), memiliki_nib: value('nib') === '' ? null : value('nib') === 'ya',
      instagram: value('instagram') || null, tiktok: value('tiktok') || null, foto: photos,
    };
    if (value('nomor')) payload.nomor = value('nomor');
    const photoUrl = value('foto_url');
    if (photoUrl) {
      const checked = validasiUrlFoto(photoUrl);
      if (!checked.ok) { setErrors({ foto: checked.alasan }); return; }
      payload.foto = [...photos, { asal: 'eksternal', url: checked.url }];
    }
    const parsed = dataPemilikSchema.safeParse(payload);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = 'Periksa isian ini dan batas panjangnya.';
      setErrors(fieldErrors); setError('Data belum lengkap atau formatnya belum sesuai.');
      return;
    }
    setBusy(true);
    operation.current ??= crypto.randomUUID();
    try {
      const hasil = mode === 'draf' && detail
        ? await kirimPemilik<MutasiPemilik>(`/${detail.id}/draf`,
          { data: parsed.data, expected_version: detail.versi, operasi_id: operation.current })
        : await kirimPemilik<MutasiPemilik>('', { data: parsed.data, operasi_id: operation.current });
      operation.current = null;
      if (number.current) number.current.value = '';
      if (mounted.current) onSelesai(hasil);
    } catch (e) {
      if (!hasilBelumPasti(e)) operation.current = null;
      if (mounted.current) {
        setError(e instanceof PemilikError ? pesanSimpan(e, draf, detail) : 'Profil belum berhasil disimpan.');
      }
    } finally { if (mounted.current) setBusy(false); }
  };

  return <Kartu judul={draf ? 'Ubah profil usaha' : 'Daftarkan usaha'}>
    <form onSubmit={submit} onChange={() => { operation.current = null; }} className={styles.formulir} autoComplete="off">
      <p className={styles.catatan}>{!draf
        ? 'Pengajuan Anda diperiksa petugas sebelum tampil di katalog. Nomor WhatsApp tidak ditampilkan kepada pengunjung. '
          + 'Foto unggahan dapat ditambahkan sesudah pendaftaran, lewat Ubah profil.'
        : detail?.status === 'terbit'
          ? 'Perubahan Anda disimpan sebagai draf dan diperiksa petugas. '
            + 'Versi lama tetap tampil di katalog sampai perubahan diperiksa.'
          : 'Profil Anda belum tampil di katalog. Perbaikan atau tambahan Anda diperiksa petugas sebelum tampil.'}</p>
      {error && <p role="alert" className={styles.galat}>{error}</p>}
      <div className={styles.bidang}>
        <Field label="Nama usaha" galat={errors.nama}>
          <input name="nama" defaultValue={rev?.nama} maxLength={200} />
        </Field>
        <Field label="Jenis" galat={errors.jenis}>
          <input name="jenis" defaultValue={rev?.jenis} maxLength={100} />
        </Field>
        <Field label="Kategori" galat={errors.kategori}>
          <input name="kategori" defaultValue={rev?.kategori} maxLength={100} />
        </Field>
        <Field label="Spesifik (opsional)" galat={errors.spesifik}>
          <input name="spesifik" defaultValue={rev?.spesifik ?? ''} maxLength={100} />
        </Field>
        <Field label="Kabupaten/kota" galat={errors.kabupaten_kota}>
          <input name="kabupaten_kota" defaultValue={rev?.kabupaten_kota} maxLength={100} />
        </Field>
        <Field label="Memiliki NIB (opsional)">
          <select
            name="nib"
            defaultValue={rev?.memiliki_nib == null ? '' : rev.memiliki_nib ? 'ya' : 'tidak'}><option
            value="">Belum diketahui</option><option
            value="ya">Ya</option><option
            value="tidak">Tidak</option></select>
        </Field>
        <Field label="Deskripsi" galat={errors.deskripsi} className={styles.lebar}>
          <textarea name="deskripsi" defaultValue={rev?.deskripsi} maxLength={4000} />
        </Field>
        <Field label="Alamat (privat, opsional)" galat={errors.alamat} className={styles.lebar}>
          <input name="alamat" defaultValue={rev?.alamat ?? ''} maxLength={500} />
        </Field>
        <Field label={draf ? 'Ganti nomor WhatsApp (opsional)' : 'Nomor WhatsApp (opsional)'} galat={errors.nomor}
          bantuan={draf ? 'Kosongkan untuk mempertahankan nomor. Nomor baru membatalkan izin lama.'
            : 'Hanya Anda dan petugas yang berwenang yang dapat melihatnya.'}>
          <input ref={number} type="tel" name="nomor" inputMode="tel" maxLength={21} autoComplete="off" /></Field>
        <Field label="Instagram (opsional)" galat={errors.instagram}>
          <input
            name="instagram"
            type="url"
            defaultValue={rev?.instagram ?? ''}
            maxLength={500}
            placeholder="https://www.instagram.com/namausaha" />
        </Field>
        <Field label="TikTok (opsional)" galat={errors.tiktok}>
          <input
            name="tiktok"
            type="url"
            defaultValue={rev?.tiktok ?? ''}
            maxLength={500}
            placeholder="https://www.tiktok.com/@namausaha" />
        </Field>
        <Field label="Tambah tautan foto HTTPS" galat={errors.foto}>
          <input name="foto_url" type="url" maxLength={500} />
        </Field>
        {draf && <Field label="Unggah foto" bantuan="JPEG, PNG, atau WebP. Foto disimpan privat sampai petugas memeriksa.">
          <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading || busy}
            onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} /></Field>}
      </div>
      {uploading && <p role="status">Mengunggah foto...</p>}
      <section aria-label="Foto yang disiapkan">
        <h3>Foto yang disiapkan</h3>
        {photos.length === 0 ? <p>Belum ada foto.</p> : <div className={styles.foto}>
          {photos.map((photo, index) => {
            const lama = detail?.foto.find((f) => f.url === photo.url && f.r2_key === photo.r2_key);
            const src = photo.asal === 'unggahan' ? (lama && `/api/umkm-pemilik/${detail!.id}/foto/${lama.id}`) : photo.url;
            return <figure key={`${photo.url ?? photo.r2_key}:${index}`}>
              {src ? <FotoUmkm src={src} alt={`Foto ${index + 1}`} width={160} height={120} style={{ width: '100%' }} />
                : <p>Foto unggahan baru {index + 1}</p>}
              <Tombol varian="sekunder" disabled={busy || uploading} aria-label={`Keluarkan foto ${index + 1}`}
                onClick={() => { operation.current = null; setPhotos((cur) => cur.filter((_, i) => i !== index)); }}>
                Keluarkan</Tombol>
            </figure>;
          })}
        </div>}
      </section>
      <div className={styles.aksi}>
        <Tombol type="submit" memuat={busy} disabled={uploading}>{draf ? 'Kirim untuk diperiksa' : 'Ajukan usaha'}</Tombol>
        <Tombol varian="hantu" onClick={onBatal} disabled={busy}>Batal</Tombol>
      </div>
    </form>
  </Kartu>;
}
