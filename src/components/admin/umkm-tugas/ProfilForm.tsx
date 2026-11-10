'use client';

import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import Field from '@/components/ui/Field';
import Tombol from '@/components/ui/Tombol';
import Kartu from '@/components/ui/Kartu';
import BagianKontak from '@/components/umkm-form/BagianKontak';
import BagianLokasi from '@/components/umkm-form/BagianLokasi';
import BagianUsaha from '@/components/umkm-form/BagianUsaha';
import EditorProduk from '@/components/umkm-form/EditorProduk';
import PemilihFoto from '@/components/umkm-form/PemilihFoto';
import { bacaIsian } from '@/components/umkm-form/baca-isian';
import { fotoProfilAwal, galatDariZod, produkAwal } from '@/components/umkm-form/bantu-form';
import { profilSchema, type FotoInput, type ProdukInput } from '@/lib/umkm-katalog/schemas';
import type { Detail, Mutasi } from '@/lib/umkm-katalog/types';
import { kompresBerkas } from '@/lib/foto/kompres';
import { unggahKeR2 } from '@/lib/storage/unggah';
import { hasilBelumPasti, kirimTugas, TugasError } from './api';
import styles from './umkm-tugas.module.css';

const PERINGATAN = 'Informasi kontak ditemukan. Bersihkan bagian ini sebelum menerbitkan.';

export default function ProfilForm({ detail, onSaved, onCancel }: { detail?: Detail; onSaved: (result: Mutasi) => void; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  const [unggahan, setUnggahan] = useState(0);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<FotoInput[]>(() => fotoProfilAwal(detail?.foto));
  const [produk, setProduk] = useState<ProdukInput[]>(() => produkAwal(detail?.produk, detail?.foto));
  const [sumber, setSumber] = useState(detail?.sumber ?? 'kurasi');
  const operation = useRef<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const mounted = useRef(true);
  const rev = detail?.revisi;
  const mandiri = detail?.sumber === 'mandiri';
  useLayoutEffect(() => {
    mounted.current = true;
    form.current?.querySelector<HTMLElement>('select, input')?.focus();
    const clear = () => {
      const input = form.current?.querySelector<HTMLInputElement>('[name="nomor"]');
      if (input) input.value = '';
      operation.current = null;
    };
    const input = form.current?.querySelector<HTMLInputElement>('[name="nomor"]');
    window.addEventListener('pagehide', clear);
    return () => {
      mounted.current = false; operation.current = null; if (input) input.value = '';
      window.removeEventListener('pagehide', clear);
    };
  }, []);

  // Selama ada unggahan berjalan (foto profil atau produk) formulir tidak boleh disimpan.
  const unggah = async (file: File): Promise<FotoInput> => {
    setUnggahan((n) => n + 1);
    try {
      const blob = await kompresBerkas(file);
      if (!mounted.current) throw new Error('Formulir sudah ditutup.');
      if (blob.size > 2 * 1024 * 1024) throw new Error('Foto masih terlalu besar. Pilih foto lain.');
      const result = await unggahKeR2('umkm-draf', `${crypto.randomUUID()}.jpg`, blob);
      operation.current = null;
      return { asal: 'unggahan', r2_key: result.kunci };
    } finally { setUnggahan((n) => n - 1); }
  };
  const pratinjau = (foto: FotoInput) => {
    const previous = detail?.foto.find((f) => f.url === (foto.url ?? null) && f.r2_key === (foto.r2_key ?? null));
    if (!previous) return undefined;
    return {
      src: foto.asal === 'unggahan' ? `/api/admin/umkm-tugas/${detail!.id}/foto/${previous.id}` : undefined,
      tersembunyi: previous.tersembunyi,
    };
  };
  const ubahFoto = (n: FotoInput[]) => { operation.current = null; setPhotos(n); };
  const ubahProduk = (n: ProdukInput[]) => { operation.current = null; setProduk(n); };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || unggahan > 0) return;
    setError(''); setErrors({});
    const data = new FormData(event.currentTarget);
    // Profil mandiri dikirim sebagai 'kurasi'. Basis data mempertahankan sumber mandiri dan pendaftarnya.
    const source = mandiri ? 'kurasi' : String(data.get('sumber') ?? '');
    const { nomor, ...isian } = bacaIsian(data);
    const payload: Record<string, unknown> = {
      ...isian, sumber: source, sumber_ref: detail?.sumber_ref ?? null, foto: photos, produk,
    };
    if (nomor) payload.nomor = nomor;
    const parsed = profilSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(galatDariZod(parsed.error)); setError('Data belum lengkap atau formatnya belum sesuai.');
      return;
    }
    setBusy(true);
    operation.current ??= crypto.randomUUID();
    try {
      const result = await kirimTugas<Mutasi>('', { data: parsed.data, operasi_id: operation.current,
        ...(detail ? { profil_id: detail.id, expected_version: detail.versi } : {}) });
      operation.current = null;
      const kolomNomor = form.current?.querySelector<HTMLInputElement>('[name="nomor"]');
      if (kolomNomor) kolomNomor.value = '';
      if (mounted.current) onSaved(result);
    } catch (e) {
      if (!hasilBelumPasti(e)) operation.current = null;
      if (mounted.current) setError(e instanceof TugasError ? e.message : 'Profil belum berhasil disimpan.');
    } finally { if (mounted.current) setBusy(false); }
  };

  // Galat zod menang atas peringatan kontak dari server.
  const peringatan: Record<string, string> = {};
  for (const kunci of detail?.peringatan_kontak ?? []) peringatan[kunci] = PERINGATAN;
  const galat = { ...peringatan, ...errors };
  return <Kartu judul={detail ? 'Perbaiki profil' : 'Tambah profil'}>
    <form ref={form} onSubmit={submit} onChange={() => { operation.current = null; }}
      className={styles.form} autoComplete="off">
      {error && <p role="alert" className={styles.galat}>{error}</p>}
      {mandiri
        ? <p>Sumber: didaftarkan pemilik</p>
        : <Field label="Sumber data"><select name="sumber" value={sumber}
          onChange={(e) => setSumber(e.target.value as typeof sumber)}><option value="kurasi">Data kurasi</option><option value="satudata">Satudata</option><option value="loket">Tamu loket</option></select></Field>}
      <BagianUsaha awal={rev} galat={galat} />
      <BagianLokasi awal={rev} galat={galat} />
      <BagianKontak awal={rev} galat={galat}
        labelNomor={detail ? 'Ganti nomor WhatsApp (opsional)' : 'Nomor WhatsApp (opsional)'}
        bantuanNomor={detail ? 'Kosongkan untuk mempertahankan nomor. Nomor baru membatalkan izin lama.' : 'Tanpa nomor tetap dapat diterbitkan.'} />
      <section className={styles.bagian} aria-label="Foto revisi baru">
        <h3>Foto untuk diperiksa</h3>
        <p role="status">{photos.length} foto disiapkan untuk pemeriksaan.</p>
        <PemilihFoto label="Foto usaha" nilai={photos} onUbah={ubahFoto} unggah={unggah} maks={10} pilihUtama
          pratinjau={pratinjau} asalTautan={sumber === 'satudata' ? 'satudata' : 'eksternal'} nonaktif={busy} />
        {galat.foto && <p role="alert" className={styles.galat}>{galat.foto}</p>}
      </section>
      <section className={styles.bagian} aria-label="Produk">
        <h3>Produk</h3>
        {galat.produk && <p role="alert" className={styles.galat}>{galat.produk}</p>}
        <EditorProduk nilai={produk} onUbah={ubahProduk} unggah={unggah} galat={galat} nonaktif={busy}
          pratinjau={(_urutan, foto) => pratinjau(foto)} />
      </section>
      <div className={styles.aksi}><Tombol type="submit" memuat={busy} disabled={unggahan > 0}>Simpan untuk diperiksa</Tombol><Tombol varian="hantu" onClick={onCancel} disabled={busy}>Batal</Tombol></div>
    </form>
  </Kartu>;
}
