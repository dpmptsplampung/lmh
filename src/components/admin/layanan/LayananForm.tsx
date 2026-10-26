'use client';

import { useRef, useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import type { InstansiRow, LayananAdmin, LayananTautan } from '@/lib/layanan/schemas';
import TautanEditor, { bersihkanTautan, validasiTautan } from './TautanEditor';

export type StatusTampilan = 'aktif' | 'coming_soon' | 'nonaktif';
export type FormPendataan = 'oss' | 'perizinan';

/** Baris layanan dari GET /api/admin/layanan. Kolom konten (Fase 1) bisa belum ada pada data lama/uji, jadi dibaca defensif. */
export type LayananRow = Omit<LayananAdmin, 'slug' | 'urutan' | 'website_terkait' | 'tampil_di_homepage'> &
  Partial<Pick<LayananAdmin, 'slug' | 'urutan' | 'website_terkait' | 'instansi_id' | 'deskripsi' | 'konten_sumber_url' | 'diarsipkan_at' | 'tampil_di_homepage'>>;

export const FORM_PENDATAAN_LABEL: Record<FormPendataan, string> = {
  oss: 'OSS (Helpdesk OSS)',
  perizinan: 'Perizinan (Non OSS)',
};

export const STATUS_LABEL: Record<StatusTampilan, string> = {
  aktif: 'Tampil',
  coming_soon: 'Segera hadir',
  nonaktif: 'Disembunyikan',
};

/** Isi permintaan: `patch` = field yang berubah (ubah) atau seluruh isian (baru); `tautan` hanya bila berubah/ada. */
export type HasilForm = {
  patch: Record<string, string | number | boolean | null>;
  tautan?: LayananTautan[];
};

const PESAN_PREFIKS = 'Prefiks antrean harus tepat 2 huruf (A-Z), atau dikosongkan agar dibuat otomatis';
const POLA_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const POLA_HTTPS = /^https:\/\/\S+$/;
const URUTAN_BAWAAN = 100;

type Bidang = 'nama' | 'prefiks' | 'slug' | 'urutan' | 'sumber' | 'instansi';
type Galat = Partial<Record<Bidang, string>>;

const sama = (a: LayananTautan[], b: LayananTautan[]) =>
  a.length === b.length && a.every((t, i) => t.label === b[i].label && t.url === b[i].url);

/** Form tambah (layanan = null) atau ubah layanan (Admin). Mode ubah hanya mengirim field yang berubah; ganti nama butuh konfirmasi. */
export default function LayananForm({
  layanan, instansi, saving, error, tautanAwal: tautanDraf, onSubmit, onCancel,
}: {
  layanan: LayananRow | null;
  instansi: InstansiRow[];
  saving: boolean;
  /** Isian website terkait yang belum tersimpan (mis. setelah PUT gagal); menggantikan nilai awal dari `layanan`. */
  tautanAwal?: LayananTautan[];
  error: string;
  onSubmit: (hasil: HasilForm) => void;
  onCancel: () => void;
}) {
  const baru = layanan === null;
  const formRef = useRef<HTMLFormElement>(null);
  const [nama, setNama] = useState(layanan?.nama ?? '');
  const [loket, setLoket] = useState(layanan?.nomor_loket ?? '');
  const [prefiks, setPrefiks] = useState(layanan?.prefiks_antrean ?? '');
  const [status, setStatus] = useState<StatusTampilan>(layanan?.status_tampilan ?? 'aktif');
  const [layar, setLayar] = useState(layanan?.tampil_di_layar ?? true);
  const [homepage, setHomepage] = useState(layanan?.tampil_di_homepage ?? true);
  const [antrean, setAntrean] = useState(layanan?.punya_antrean ?? true);
  const [chat, setChat] = useState(layanan?.punya_chat ?? true);
  const [form, setForm] = useState<string>(layanan?.form_pendataan ?? '');
  const [instansiId, setInstansiId] = useState(layanan?.instansi_id ?? '');
  const [slug, setSlug] = useState(layanan?.slug ?? '');
  const [deskripsi, setDeskripsi] = useState(layanan?.deskripsi ?? '');
  const [urutan, setUrutan] = useState(String(layanan?.urutan ?? URUTAN_BAWAAN));
  const [sumber, setSumber] = useState(layanan?.konten_sumber_url ?? '');
  const [tautan, setTautan] = useState<LayananTautan[]>(() => (tautanDraf ?? layanan?.website_terkait ?? []).map((t) => ({ ...t })));
  const [tampilkanGalatTautan, setTampilkanGalatTautan] = useState(false);
  const [localError, setLocalError] = useState('');
  const [galatLokal, setGalatLokal] = useState<Galat>({});
  const [konfirmasiNama, setKonfirmasiNama] = useState(false);

  const tautanAwal = (layanan?.website_terkait ?? []);

  // Galat dari server dipetakan ke isian terkait lewat isi pesannya (prefiks/slug/nama bentrok, instansi tidak ada).
  const galatServer: Galat = {};
  if (/prefiks/i.test(error)) galatServer.prefiks = error;
  else if (/slug/i.test(error)) galatServer.slug = error;
  else if (/^nama layanan/i.test(error)) galatServer.nama = error;
  else if (/^instansi/i.test(error)) galatServer.instansi = error;
  const galatDi = (b: Bidang) => galatLokal[b] || galatServer[b] || '';
  const msg = localError || (Object.keys(galatServer).length > 0 ? '' : error);

  const bersihGalat = (b: Bidang) => setGalatLokal((g) => (g[b] ? { ...g, [b]: undefined } : g));

  const kirim = () => {
    const tautanBersih = bersihkanTautan(tautan);
    const tautanBerubah = !sama(tautanBersih, tautanAwal);
    const urutanAngka = Number(urutan);
    if (baru) {
      const isi: HasilForm['patch'] = {
        nama: nama.trim(),
        status_tampilan: status,
        tampil_di_layar: layar,
        tampil_di_homepage: homepage,
        punya_antrean: antrean,
        punya_chat: chat,
        // Dikirim eksplisit: null = "Tanpa formulir tetap" (tidak lagi ditebak dari nama).
        form_pendataan: form || null,
        urutan: urutanAngka,
      };
      if (loket.trim()) isi.nomor_loket = loket.trim();
      if (prefiks.trim()) isi.prefiks = prefiks.trim().toUpperCase();
      if (instansiId) isi.instansi_id = instansiId;
      if (slug.trim()) isi.slug = slug.trim();
      if (deskripsi.trim()) isi.deskripsi = deskripsi.trim();
      if (sumber.trim()) isi.konten_sumber_url = sumber.trim();
      onSubmit({ patch: isi, tautan: tautanBersih.length > 0 ? tautanBersih : undefined });
      return;
    }
    const patch: HasilForm['patch'] = {};
    if (nama.trim() !== layanan.nama) patch.nama = nama.trim();
    if ((loket.trim() || null) !== layanan.nomor_loket) patch.nomor_loket = loket.trim() || null;
    if ((prefiks.trim().toUpperCase() || null) !== layanan.prefiks_antrean) patch.prefiks = prefiks.trim().toUpperCase() || null;
    if (status !== layanan.status_tampilan) patch.status_tampilan = status;
    if (layar !== layanan.tampil_di_layar) patch.tampil_di_layar = layar;
    if (homepage !== (layanan.tampil_di_homepage ?? true)) patch.tampil_di_homepage = homepage;
    if (antrean !== layanan.punya_antrean) patch.punya_antrean = antrean;
    if (chat !== layanan.punya_chat) patch.punya_chat = chat;
    if ((form || null) !== (layanan.form_pendataan ?? null)) patch.form_pendataan = form || null;
    if ((instansiId || null) !== (layanan.instansi_id ?? null)) patch.instansi_id = instansiId || null;
    if (slug.trim() !== (layanan.slug ?? '')) patch.slug = slug.trim();
    if ((deskripsi.trim() || null) !== (layanan.deskripsi ?? null)) patch.deskripsi = deskripsi.trim() || null;
    if (urutanAngka !== (layanan.urutan ?? URUTAN_BAWAAN)) patch.urutan = urutanAngka;
    if ((sumber.trim() || null) !== (layanan.konten_sumber_url ?? null)) patch.konten_sumber_url = sumber.trim() || null;
    if (Object.keys(patch).length === 0 && !tautanBerubah) {
      setLocalError('Tidak ada perubahan.');
      return;
    }
    onSubmit({ patch, tautan: tautanBerubah ? tautanBersih : undefined });
  };

  const handle = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');
    // Hanya yang DIUBAH yang divalidasi (nilai lama yang tidak disentuh tidak memblokir perubahan lain).
    const g: Galat = {};
    if (nama.trim().length < 2) g.nama = 'Nama layanan minimal 2 karakter.';
    if (prefiks !== (layanan?.prefiks_antrean ?? '') && prefiks && !/^[A-Z]{2}$/.test(prefiks)) g.prefiks = PESAN_PREFIKS;
    if (slug.trim() !== (layanan?.slug ?? '')) {
      if (slug.trim() === '') g.slug = 'Alamat halaman tidak boleh kosong.';
      else if (slug.length > 80 || !POLA_SLUG.test(slug.trim())) g.slug = 'Alamat halaman hanya huruf kecil, angka, dan tanda hubung (tidak di awal atau akhir), maksimal 80 karakter.';
    }
    if (!/^\d{1,4}$/.test(urutan.trim())) g.urutan = 'Urutan berupa bilangan bulat 0 sampai 9999.';
    if (sumber.trim() && (sumber.trim().length > 500 || !POLA_HTTPS.test(sumber.trim()))) {
      g.sumber = 'Alamat sumber harus diawali https:// dan tanpa spasi (maksimal 500 karakter).';
    }
    const adaGalatTautan = validasiTautan(tautan).some((x) => x !== null);
    setTampilkanGalatTautan(true);
    setGalatLokal(g);
    if (Object.keys(g).length > 0 || adaGalatTautan) {
      // Pindahkan fokus ke isian bermasalah pertama setelah galat tampil, agar pembaca layar langsung membacanya.
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    if (!baru && nama.trim() !== layanan.nama && !konfirmasiNama) {
      setKonfirmasiNama(true);
      return;
    }
    kirim();
  };

  const ids = (b: Bidang, bantuan?: string) => {
    const g = galatDi(b);
    const daftar = [bantuan, g ? `ly${b[0].toUpperCase()}${b.slice(1)}Galat` : undefined].filter(Boolean).join(' ');
    return { 'aria-invalid': g ? (true as const) : undefined, 'aria-describedby': daftar || undefined };
  };
  const pesanGalat = (b: Bidang) => {
    const g = galatDi(b);
    return g ? <p id={`ly${b[0].toUpperCase()}${b.slice(1)}Galat`} className="form-error" role="alert">{g}</p> : null;
  };
  const kolom = { display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' } as const;
  const subjudul = { fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-secondary)', margin: 'var(--space-2) 0 0' } as const;

  return (
    <form ref={formRef} onSubmit={handle} noValidate style={{ ...kolom, gap: 'var(--space-4)' }}>
      {msg && <p className="form-error" role="alert">{msg}</p>}

      <h3 style={subjudul}>Informasi layanan</h3>
      <div className="form-group">
        <label className="form-label form-label--required" htmlFor="lyNama">Nama layanan</label>
        <input id="lyNama" className="form-input" value={nama} maxLength={100} {...ids('nama')}
          onChange={(e) => { setNama(e.target.value); setKonfirmasiNama(false); bersihGalat('nama'); }} />
        {pesanGalat('nama')}
      </div>
      {konfirmasiNama && (
        <div role="alertdialog" aria-label="Konfirmasi ganti nama"
          style={{ border: '1px solid var(--color-warning-500, #f59e0b)', borderRadius: 'var(--radius-md, 8px)', padding: 'var(--space-3)', display: 'flex', gap: 'var(--space-2)' }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
          <p style={{ margin: 0 }}>
            Beberapa fitur mencocokkan layanan berdasarkan <strong>nama</strong>. Mengganti nama dari
            {' '}<strong>{layanan?.nama}</strong> menjadi <strong>{nama.trim()}</strong> bisa memutus pencocokan tersebut. Lanjutkan?
          </p>
        </div>
      )}
      <div className="form-group">
        <label className="form-label" htmlFor="lyInstansi">Instansi</label>
        <select id="lyInstansi" className="form-input" value={instansiId} {...ids('instansi')}
          onChange={(e) => { setInstansiId(e.target.value); bersihGalat('instansi'); }}>
          <option value="">Tanpa instansi</option>
          {instansi.map((i) => (
            <option key={i.id} value={i.id}>{i.singkatan ? `${i.nama} (${i.singkatan})` : i.nama}</option>
          ))}
        </select>
        {pesanGalat('instansi')}
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="lyDeskripsi">Deskripsi</label>
        <textarea id="lyDeskripsi" className="form-input" rows={4} value={deskripsi} maxLength={4000}
          aria-describedby="lyDeskripsiBantuan" onChange={(e) => setDeskripsi(e.target.value)} />
        <p id="lyDeskripsiBantuan" className="form-hint">Penjelasan singkat layanan untuk halaman publik. Maksimal 4.000 karakter.</p>
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="lySumber">Sumber konten (alamat https://)</label>
        <input id="lySumber" className="form-input" type="url" inputMode="url" value={sumber} maxLength={500}
          spellCheck={false} autoCapitalize="none" placeholder="https://" {...ids('sumber', 'lySumberBantuan')}
          onChange={(e) => { setSumber(e.target.value); bersihGalat('sumber'); }} />
        <p id="lySumberBantuan" className="form-hint">Halaman resmi tempat deskripsi ini diambil. Kosongkan bila tidak ada.</p>
        {pesanGalat('sumber')}
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="lySlug">Alamat halaman (slug)</label>
        <input id="lySlug" className="form-input" value={slug} maxLength={80} spellCheck={false} autoCapitalize="none"
          {...ids('slug', 'lySlugBantuan')}
          onChange={(e) => { setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')); bersihGalat('slug'); }} />
        <p id="lySlugBantuan" className="form-hint">
          {baru
            ? 'Huruf kecil, angka, dan tanda hubung. Kosongkan agar dibuat otomatis dari nama.'
            : 'Huruf kecil, angka, dan tanda hubung. Mengganti alamat ini mengubah tautan ke halaman layanan.'}
        </p>
        {pesanGalat('slug')}
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="lyUrutan">Urutan tampil</label>
        <input id="lyUrutan" className="form-input" type="number" inputMode="numeric" min={0} max={9999} step={1}
          value={urutan} {...ids('urutan', 'lyUrutanBantuan')}
          onChange={(e) => { setUrutan(e.target.value); bersihGalat('urutan'); }} />
        <p id="lyUrutanBantuan" className="form-hint">Angka kecil tampil lebih dulu di daftar layanan (0 sampai 9999).</p>
        {pesanGalat('urutan')}
      </div>

      <h3 style={subjudul}>Loket, antrean, dan tampilan</h3>
      <div className="form-group">
        <label className="form-label" htmlFor="lyLoket">Nomor loket</label>
        <input id="lyLoket" className="form-input" value={loket} maxLength={20} onChange={(e) => setLoket(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="lyPrefiks">Prefiks antrean</label>
        <input id="lyPrefiks" className="form-input" value={prefiks} maxLength={2} autoCapitalize="characters" spellCheck={false}
          {...ids('prefiks', 'lyPrefiksBantuan')}
          onChange={(e) => { setPrefiks(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2)); bersihGalat('prefiks'); }} />
        <p id="lyPrefiksBantuan" className="form-hint">
          Tepat 2 huruf (A-Z), unik antar layanan. Kosongkan agar dibuat otomatis. Hanya memengaruhi nomor antrean BARU.
        </p>
        {pesanGalat('prefiks')}
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="lyStatus">Di halaman utama / daftar layanan</label>
        <select id="lyStatus" className="form-input" value={status} onChange={(e) => setStatus(e.target.value as StatusTampilan)}>
          <option value="aktif">Tampil</option>
          <option value="coming_soon">Segera hadir</option>
          <option value="nonaktif">Disembunyikan</option>
        </select>
        <p className="form-hint">Tidak memengaruhi penerbitan tiket atau check-in.</p>
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="lyForm">Formulir Pendataan</label>
        <select id="lyForm" className="form-input" value={form} onChange={(e) => setForm(e.target.value)}
          aria-describedby="lyFormBantuan">
          <option value="">Tanpa formulir tetap</option>
          <option value="oss">{FORM_PENDATAAN_LABEL.oss}</option>
          <option value="perizinan">{FORM_PENDATAAN_LABEL.perizinan}</option>
        </select>
        <p id="lyFormBantuan" className="form-hint">
          Bila memilih OSS atau Perizinan, petugas WAJIB mengisi formulir itu (semua field) sebelum tiket layanan dapat diselesaikan.
        </p>
      </div>
      <label style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <input type="checkbox" checked={homepage} onChange={(e) => setHomepage(e.target.checked)} /> Tampil di homepage
      </label>
      <label style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <input type="checkbox" checked={layar} onChange={(e) => setLayar(e.target.checked)} /> Tampil di layar TV
      </label>
      <label style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <input type="checkbox" checked={antrean} onChange={(e) => setAntrean(e.target.checked)} /> Punya antrean
      </label>
      <label style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <input type="checkbox" checked={chat} onChange={(e) => setChat(e.target.checked)} /> Punya chat
      </label>

      <TautanEditor value={tautan} onChange={setTautan} disabled={saving} tampilkanGalat={tampilkanGalatTautan} />

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>Batal</button>
        <button type="submit" className="btn btn--primary" disabled={saving} aria-busy={saving}>
          {saving ? <Loader2 size={16} className="animate-pulse" aria-hidden="true" /> : null}
          {konfirmasiNama ? 'Ya, ganti nama' : 'Simpan'}
        </button>
      </div>
    </form>
  );
}
