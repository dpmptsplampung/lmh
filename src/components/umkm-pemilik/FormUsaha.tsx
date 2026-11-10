'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Kartu from '@/components/ui/Kartu';
import Tombol from '@/components/ui/Tombol';
import BagianKontak from '@/components/umkm-form/BagianKontak';
import BagianLokasi from '@/components/umkm-form/BagianLokasi';
import BagianUsaha from '@/components/umkm-form/BagianUsaha';
import EditorProduk from '@/components/umkm-form/EditorProduk';
import PemilihFoto from '@/components/umkm-form/PemilihFoto';
import { bacaIsian } from '@/components/umkm-form/baca-isian';
import { fotoProfilAwal, galatDariZod, produkAwal } from '@/components/umkm-form/bantu-form';
import { kompresBerkas } from '@/lib/foto/kompres';
import { AWALAN_AKUN } from '@/lib/storage/area';
import { unggahKeR2 } from '@/lib/storage/unggah';
import type { FotoInput, ProdukInput } from '@/lib/umkm-katalog/schemas';
import { profilPemilikSchema } from '@/lib/umkm-katalog/schemas-g5';
import { PemilikError, hasilBelumPasti, kirimPemilik } from './api';
import type { DetailUsaha, MutasiPemilik } from '@/lib/umkm-katalog/types-g5';
import styles from './pemilik.module.css';

function pesanSimpan(e: PemilikError, draf: boolean, detail?: DetailUsaha): string {
  if (draf && e.code === 'KONFLIK_STATUS' && detail?.status === 'disembunyikan') {
    return 'Profil sedang disembunyikan petugas. Perubahan bisa dikirim lagi sesudah petugas memulihkannya.';
  }
  return e.message;
}

type Props = { mode: 'daftar' | 'draf'; detail?: DetailUsaha; onSelesai: (hasil: MutasiPemilik) => void; onBatal: () => void };

// Formulir sama dengan formulir profil petugas, tanpa sumber data dan tanpa tindakan menerbitkan.
// Foto diunggah ke area draf pribadi: pendaftar baru ke folder akunnya (`akun/`), pemilik usaha ke folder profilnya.
export default function FormUsaha({ mode, detail, onSelesai, onBatal }: Props) {
  const rev = detail?.revisi ?? null;
  const draf = mode === 'draf';
  const [busy, setBusy] = useState(false);
  const [unggahan, setUnggahan] = useState(0);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<FotoInput[]>(() => fotoProfilAwal(detail?.foto));
  const [produk, setProduk] = useState<ProdukInput[]>(() => produkAwal(detail?.produk, detail?.foto));
  const operation = useRef<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const kolomNomor = () => form.current?.querySelector<HTMLInputElement>('[name="nomor"]');
    const clear = () => { const input = kolomNomor(); if (input) input.value = ''; operation.current = null; };
    window.addEventListener('pagehide', clear);
    return () => { mounted.current = false; clear(); window.removeEventListener('pagehide', clear); };
  }, []);

  // Selama ada unggahan berjalan (foto profil atau produk) formulir tidak boleh dikirim.
  const unggah = async (file: File): Promise<FotoInput> => {
    setUnggahan((n) => n + 1);
    try {
      const blob = await kompresBerkas(file);
      if (!mounted.current) throw new Error('Formulir sudah ditutup.');
      if (blob.size > 2 * 1024 * 1024) throw new Error('Foto masih terlalu besar. Pilih foto lain.');
      const folder = draf && detail ? `${detail.id}/` : AWALAN_AKUN;
      const hasil = await unggahKeR2('umkm-draf', `${folder}${crypto.randomUUID()}.jpg`, blob);
      operation.current = null;
      return { asal: 'unggahan', r2_key: hasil.kunci };
    } finally { setUnggahan((n) => n - 1); }
  };
  const pratinjau = (foto: FotoInput) => {
    if (foto.asal !== 'unggahan' || !detail) return undefined;
    const lama = detail.foto.find((f) => f.url === (foto.url ?? null) && f.r2_key === (foto.r2_key ?? null));
    return lama ? { src: `/api/umkm-pemilik/${detail.id}/foto/${lama.id}` } : undefined;
  };
  const ubahFoto = (n: FotoInput[]) => { operation.current = null; setPhotos(n); };
  const ubahProduk = (n: ProdukInput[]) => { operation.current = null; setProduk(n); };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || unggahan > 0) return;
    setError(''); setErrors({});
    const { nomor, ...isian } = bacaIsian(new FormData(event.currentTarget));
    const payload: Record<string, unknown> = { ...isian, foto: photos, produk };
    if (nomor) payload.nomor = nomor;
    const parsed = profilPemilikSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(galatDariZod(parsed.error)); setError('Data belum lengkap atau formatnya belum sesuai.');
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
      const kolomNomor = form.current?.querySelector<HTMLInputElement>('[name="nomor"]');
      if (kolomNomor) kolomNomor.value = '';
      if (mounted.current) onSelesai(hasil);
    } catch (e) {
      if (!hasilBelumPasti(e)) operation.current = null;
      if (mounted.current) {
        setError(e instanceof PemilikError ? pesanSimpan(e, draf, detail) : 'Profil belum berhasil disimpan.');
      }
    } finally { if (mounted.current) setBusy(false); }
  };

  return <Kartu judul={draf ? 'Ubah profil usaha' : 'Daftarkan usaha'}>
    <form ref={form} onSubmit={submit} onChange={() => { operation.current = null; }} className={styles.formulir}
      autoComplete="off">
      <p className={styles.catatan}>{!draf
        ? 'Pengajuan Anda diperiksa petugas sebelum tampil di katalog. Nomor WhatsApp, nama pemilik, dan alamat '
          + 'tidak ditampilkan kepada pengunjung.'
        : detail?.status === 'terbit'
          ? 'Perubahan Anda disimpan sebagai draf dan diperiksa petugas. '
            + 'Versi lama tetap tampil di katalog sampai perubahan diperiksa.'
          : 'Profil Anda belum tampil di katalog. Perbaikan atau tambahan Anda diperiksa petugas sebelum tampil.'}</p>
      {error && <p role="alert" className={styles.galat}>{error}</p>}
      <BagianUsaha awal={rev ?? undefined} galat={errors} />
      <BagianLokasi awal={rev ?? undefined} galat={errors} />
      <BagianKontak awal={rev ?? undefined} galat={errors}
        labelNomor={draf ? 'Ganti nomor WhatsApp (opsional)' : 'Nomor WhatsApp (opsional)'}
        bantuanNomor={draf ? 'Kosongkan untuk mempertahankan nomor. Nomor baru membatalkan izin lama.' : undefined} />
      <PemilihFoto label="Foto usaha" nilai={photos} onUbah={ubahFoto} unggah={unggah} maks={10} pilihUtama
        pratinjau={pratinjau} nonaktif={busy} />
      {errors.foto && <p role="alert" className={styles.galat}>{errors.foto}</p>}
      <section aria-label="Produk">
        <h3>Produk</h3>
        <EditorProduk nilai={produk} onUbah={ubahProduk} unggah={unggah} galat={errors} nonaktif={busy}
          pratinjau={(_urutan, foto) => pratinjau(foto)} />
      </section>
      <div className={styles.aksi}>
        <Tombol type="submit" memuat={busy} disabled={unggahan > 0}>{draf ? 'Kirim untuk diperiksa' : 'Ajukan usaha'}</Tombol>
        <Tombol varian="hantu" onClick={onBatal} disabled={busy}>Batal</Tombol>
      </div>
    </form>
  </Kartu>;
}
