'use client';

// Pendaftaran walk-in oleh Front Office (K3, tugas UI-2). Satu-satunya jalur penulisan walk-in:
// rpc `fo_mulai_kunjungan` (kontrak docs/analysis/FO-ESKALASI-KONTRAK-RPC.md §2.1). Tidak menerbitkan tiket;
// sukses -> halaman Penanganan. Offline: antrean IndexedDB (idempoten lewat p_client_request_id) milik FO.
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, UserPlus } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import { KATEGORI_PENGUNJUNG } from '@/lib/constants';
import { enqueueAction } from '@/lib/offline/queue';
import { daftarkanSyncOffline } from '@/lib/offline/sync';
import { urlLoginAlasan } from '@/lib/sesi-staf';
import { GalatRpc } from '@/lib/rpc-galat';
import {
  BATAS_WALKIN,
  KATEGORI_WALKIN,
  PESAN_GALAT_JARINGAN,
  WALKIN_KOSONG,
  bangunParamFoMulai,
  panggilFoMulaiKunjungan,
  pesanGalatFoMulai,
  validasiWalkin,
  type DataWalkin,
  type GalatFormWalkin,
  type ParamFoMulai,
} from '@/lib/fo/walkin';
import styles from './daftar.module.css';

interface LayananOpsi {
  id: string;
  nama: string;
}

// Urutan fokus bila validasi gagal.
const URUTAN_FIELD: (keyof DataWalkin)[] = ['nama', 'asal_instansi', 'kontak_hp', 'kategori', 'email', 'keperluan'];

export default function FoDaftarPage() {
  const router = useRouter();
  const [form, setForm] = useState<DataWalkin>(WALKIN_KOSONG);
  const [galatField, setGalatField] = useState<GalatFormWalkin>({});
  const [galat, setGalat] = useState('');
  const [sesiBerakhir, setSesiBerakhir] = useState(false);
  const [info, setInfo] = useState('');
  const [mengirim, setMengirim] = useState(false);
  const [layanan, setLayanan] = useState<LayananOpsi[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  // Guard sinkron: klik ganda sebelum re-render tidak boleh mengirim dua kali.
  const kirimRef = useRef(false);
  // client_request_id dibuat SEKALI per percobaan dan dipakai ulang saat retry dengan data yang sama
  // (kontrak §2.1). Bila isian diubah, id baru dibuat supaya data baru tidak "tertimpa" kunjungan lama.
  const idRef = useRef<{ id: string; kunci: string } | null>(null);

  useEffect(() => {
    let aktif = true;
    const supabase = createClient();
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (aktif) setUserId(data.session?.user.id ?? null);
      } catch {
        // tanpa id pemilik, pendaftaran offline ditolak dengan pesan jelas
      }
      try {
        const { data, error } = await supabase
          .from('layanan')
          .select('id, nama')
          .eq('aktif', true)
          .eq('punya_antrean', true)
          .order('nama');
        if (!error && aktif) setLayanan((data ?? []) as LayananOpsi[]);
      } catch {
        // saran layanan opsional: form tetap bisa dipakai
      }
    })();
    return () => {
      aktif = false;
    };
  }, []);

  const ubah = useCallback(<K extends keyof DataWalkin>(k: K, v: DataWalkin[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setGalatField((g) => (g[k] ? { ...g, [k]: undefined } : g));
  }, []);

  const simpanOffline = async (param: ParamFoMulai) => {
    if (!userId) throw new Error('tanpa pemilik');
    await enqueueAction({ type: 'fo_walkin', payload: { ...param }, owner_user_id: userId });
    void daftarkanSyncOffline();
    idRef.current = null;
    setForm(WALKIN_KOSONG);
    setInfo(
      'Koneksi terputus: pendaftaran disimpan di perangkat ini dan akan dikirim otomatis saat koneksi kembali. Pengunjung belum tercatat di server.',
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (kirimRef.current) return;
    setGalat('');
    setSesiBerakhir(false);
    setInfo('');

    const salah = validasiWalkin(form);
    setGalatField(salah);
    const pertama = URUTAN_FIELD.find((k) => salah[k]);
    if (pertama) {
      setGalat('Periksa kembali isian yang ditandai.');
      document.getElementById(`fo-${pertama}`)?.focus();
      return;
    }

    kirimRef.current = true;
    setMengirim(true);
    try {
      const kunci = JSON.stringify(bangunParamFoMulai(form, ''));
      if (!idRef.current || idRef.current.kunci !== kunci) {
        idRef.current = { id: crypto.randomUUID(), kunci };
      }
      const param = bangunParamFoMulai(form, idRef.current.id);

      try {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          try {
            await simpanOffline(param);
          } catch {
            setGalat(`${PESAN_GALAT_JARINGAN} Pendaftaran belum tersimpan, jangan tutup halaman ini.`);
          }
          return;
        }
        await panggilFoMulaiKunjungan(createClient(), param);
        idRef.current = null;
        setForm(WALKIN_KOSONG);
        setInfo('Kunjungan terdaftar. Membuka halaman Penanganan…');
        router.push('/admin/fo/penanganan');
      } catch (err) {
        if (err instanceof GalatRpc && err.jaringan) {
          // Hasil di server tidak diketahui; aman menyimpan offline karena id yang sama bersifat idempoten.
          try {
            await simpanOffline(param);
          } catch {
            setGalat(PESAN_GALAT_JARINGAN);
          }
        } else {
          setGalat(pesanGalatFoMulai(err));
          if (err instanceof GalatRpc && err.kode === 'SESI_TIDAK_SAH') setSesiBerakhir(true);
        }
      }
    } finally {
      kirimRef.current = false;
      setMengirim(false);
    }
  };

  const idGalat = (k: keyof DataWalkin) => (galatField[k] ? `fo-${k}-galat` : undefined);

  return (
    <>
      <PageHeader
        title="Daftarkan Pengunjung Walk-in"
        description="Catat pengunjung yang datang langsung. Pengunjung dilayani Front Office lebih dulu; tiket antrean baru terbit saat Anda mengeskalasi ke petugas layanan."
      />
      <div className={styles.wrap}>
        <div className={styles.card}>
          <div aria-live="polite" role="status">
            {info && <div className={styles.notice}>{info}</div>}
          </div>
          {galat && (
            <div className={`form-error ${styles.errorBox}`} role="alert">
              {galat}
              {sesiBerakhir && (
                <>
                  {' '}
                  <Link href={urlLoginAlasan('tidak_terdaftar')}>Masuk kembali</Link>
                </>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <div className={styles.grid}>
              <div className="form-group">
                <label className="form-label form-label--required" htmlFor="fo-nama">
                  Nama Lengkap
                </label>
                <input
                  id="fo-nama"
                  type="text"
                  className="form-input"
                  value={form.nama}
                  onChange={(e) => ubah('nama', e.target.value)}
                  maxLength={BATAS_WALKIN.namaMax}
                  autoComplete="off"
                  required
                  aria-required="true"
                  aria-invalid={galatField.nama ? true : undefined}
                  aria-describedby={idGalat('nama')}
                  disabled={mengirim}
                />
                {galatField.nama && (
                  <span id="fo-nama-galat" className={styles.fieldError}>
                    {galatField.nama}
                  </span>
                )}
              </div>

              <div className="form-group">
                <label className="form-label form-label--required" htmlFor="fo-asal_instansi">
                  Asal / Instansi
                </label>
                <input
                  id="fo-asal_instansi"
                  type="text"
                  className="form-input"
                  placeholder="Contoh: PT Lampung Berjaya / Kedaton"
                  value={form.asal_instansi}
                  onChange={(e) => ubah('asal_instansi', e.target.value)}
                  maxLength={BATAS_WALKIN.asalMax}
                  autoComplete="off"
                  required
                  aria-required="true"
                  aria-invalid={galatField.asal_instansi ? true : undefined}
                  aria-describedby={idGalat('asal_instansi')}
                  disabled={mengirim}
                />
                {galatField.asal_instansi && (
                  <span id="fo-asal_instansi-galat" className={styles.fieldError}>
                    {galatField.asal_instansi}
                  </span>
                )}
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="fo-kontak_hp">
                  Nomor Handphone
                </label>
                <input
                  id="fo-kontak_hp"
                  type="tel"
                  className="form-input"
                  placeholder="Contoh: 0812xxxxxxx (opsional)"
                  value={form.kontak_hp}
                  onChange={(e) => ubah('kontak_hp', e.target.value)}
                  autoComplete="off"
                  aria-invalid={galatField.kontak_hp ? true : undefined}
                  aria-describedby={idGalat('kontak_hp')}
                  disabled={mengirim}
                />
                {galatField.kontak_hp && (
                  <span id="fo-kontak_hp-galat" className={styles.fieldError}>
                    {galatField.kontak_hp}
                  </span>
                )}
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="fo-kategori">
                  Kategori Pengunjung
                </label>
                <select
                  id="fo-kategori"
                  className="form-select"
                  value={form.kategori}
                  onChange={(e) => ubah('kategori', e.target.value)}
                  aria-invalid={galatField.kategori ? true : undefined}
                  aria-describedby={idGalat('kategori')}
                  disabled={mengirim}
                >
                  <option value="">— Belum ditentukan —</option>
                  {KATEGORI_WALKIN.map((k) => (
                    <option key={k} value={k}>
                      {KATEGORI_PENGUNJUNG[k]}
                    </option>
                  ))}
                </select>
                {galatField.kategori && (
                  <span id="fo-kategori-galat" className={styles.fieldError}>
                    {galatField.kategori}
                  </span>
                )}
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="fo-email">
                  Email
                </label>
                <input
                  id="fo-email"
                  type="email"
                  className="form-input"
                  placeholder="opsional"
                  value={form.email}
                  onChange={(e) => ubah('email', e.target.value)}
                  autoComplete="off"
                  aria-invalid={galatField.email ? true : undefined}
                  aria-describedby={idGalat('email')}
                  disabled={mengirim}
                />
                {galatField.email && (
                  <span id="fo-email-galat" className={styles.fieldError}>
                    {galatField.email}
                  </span>
                )}
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="fo-layanan_saran_id">
                  Layanan Saran
                </label>
                <select
                  id="fo-layanan_saran_id"
                  className="form-select"
                  value={form.layanan_saran_id}
                  onChange={(e) => ubah('layanan_saran_id', e.target.value)}
                  aria-describedby="fo-layanan_saran_id-hint"
                  disabled={mengirim}
                >
                  <option value="">— Tidak ada saran —</option>
                  {layanan.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nama}
                    </option>
                  ))}
                </select>
                <span id="fo-layanan_saran_id-hint" className="form-hint">
                  Opsional. Hanya saran tujuan eskalasi, bukan tiket.
                </span>
              </div>

              <div className={`form-group ${styles.full}`}>
                <label className="form-label" htmlFor="fo-keperluan">
                  Keperluan
                </label>
                <textarea
                  id="fo-keperluan"
                  className="form-textarea"
                  rows={3}
                  placeholder="Tuliskan keperluan kunjungan secara singkat (opsional)"
                  value={form.keperluan}
                  onChange={(e) => ubah('keperluan', e.target.value)}
                  maxLength={BATAS_WALKIN.keperluanMax}
                  aria-invalid={galatField.keperluan ? true : undefined}
                  aria-describedby={idGalat('keperluan')}
                  disabled={mengirim}
                />
                {galatField.keperluan && (
                  <span id="fo-keperluan-galat" className={styles.fieldError}>
                    {galatField.keperluan}
                  </span>
                )}
                <span className={styles.counter}>
                  {form.keperluan.length}/{BATAS_WALKIN.keperluanMax}
                </span>
              </div>
            </div>

            <div className={styles.actions}>
              <button type="submit" className="btn btn--primary btn--lg" disabled={mengirim}>
                {mengirim ? (
                  <>
                    <Loader2 size={18} className="animate-pulse" aria-hidden="true" /> Menyimpan…
                  </>
                ) : (
                  <>
                    <UserPlus size={18} aria-hidden="true" /> Daftarkan &amp; Mulai Layani
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
