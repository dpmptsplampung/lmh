'use client';

// Panel "Walk-in" pada halaman Registrasi Pengunjung (/admin/fo/registrasi?tab=walkin), dulu halaman /admin/fo/daftar.
// Pendaftaran walk-in oleh Front Office (K3, tugas UI-2). Satu-satunya jalur penulisan walk-in:
// rpc `fo_mulai_kunjungan` (kontrak docs/analysis/FO-ESKALASI-KONTRAK-RPC.md §2.1). Tidak menerbitkan tiket;
// sukses -> halaman Penanganan. Offline: antrean IndexedDB (idempoten lewat p_client_request_id) milik FO.
//
// Semua isian wajib KECUALI email (opsional sejak 202610140015; bila diisi tetap divalidasi). Aturan di
// src/lib/fo/walkin.ts, sama dengan DB. Formulir "pintar": validasi per isian saat
// blur (bukan sebelum disentuh), ringkasan + fokus ke galat pertama saat kirim, normalisasi HP/email/nama, saran
// koreksi email, pengenalan pengunjung lama, datalist asal/instansi. Tombol kirim SENGAJA tetap aktif (kecuali
// sedang mengirim): tombol mati tidak bisa difokuskan dan tidak menjelaskan apa yang kurang (a11y).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CircleAlert, CircleCheck, ClipboardList, History, Loader2, Phone, User, UserPlus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { KATEGORI_PENGUNJUNG } from '@/lib/constants';
import { enqueueAction } from '@/lib/offline/queue';
import { daftarkanSyncOffline } from '@/lib/offline/sync';
import { urlLoginAlasan } from '@/lib/sesi-staf';
import { GalatRpc } from '@/lib/rpc-galat';
import { todayWIB } from '@/lib/time';
import {
  BATAS_WALKIN,
  KATEGORI_WALKIN,
  LABEL_FIELD_WALKIN,
  LAYANAN_BELUM_TAHU,
  PESAN_GALAT_JARINGAN,
  URUTAN_FIELD_WALKIN,
  WALKIN_KOSONG,
  bangunParamFoMulai,
  formatHpTampil,
  galatFieldServer,
  normalisasiEmail,
  normalisasiHp,
  panggilFoMulaiKunjungan,
  periksaEmail,
  periksaHp,
  pesanGalatFoMulai,
  rapikanNama,
  sarankanEmail,
  validasiParamFoMulai,
  validasiWalkin,
  type DataWalkin,
  type GalatFieldServer,
  type ParamFoMulai,
} from '@/lib/fo/walkin';
import { cariPengunjungLama, muatAsalSering, type PengunjungLama } from '@/lib/fo/pengunjung-lama';
import styles from './walkin-panel.module.css';

interface LayananOpsi {
  id: string;
  nama: string;
}

type Umpan = { jenis: 'galat' | 'info'; teks: string; sesiBerakhir?: boolean; field?: keyof DataWalkin };

/** Jeda (ms) setelah HP/email terakhir diketik sebelum mencari pengunjung lama. */
const JEDA_CARI_PENGUNJUNG_MS = 350;

const idField = (k: keyof DataWalkin) => `fo-${k}`;

function formatTanggalId(tanggal: string): string {
  const d = new Date(`${tanggal}T00:00:00+07:00`);
  if (Number.isNaN(d.getTime())) return tanggal;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
}

function fokusField(k: keyof DataWalkin) {
  const el = document.getElementById(idField(k));
  if (!el) return;
  el.focus();
  el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
}

/** Satu isian: label + ikon status + kontrol + petunjuk + galat, dengan id yang saling terhubung (aria-describedby). */
function Kolom(props: {
  k: keyof DataWalkin;
  label: string;
  hint?: string;
  galat?: string;
  valid: boolean;
  penuh?: boolean;
  /** Isian boleh kosong (tanpa tanda bintang). */
  opsional?: boolean;
  tambahan?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { k, label, hint, galat, valid, penuh, opsional, tambahan, children } = props;
  return (
    <div className={`form-group ${styles.kolom} ${penuh ? styles.penuh : ''}`}>
      <div className={styles.labelBaris}>
        <label className={opsional ? 'form-label' : 'form-label form-label--required'} htmlFor={idField(k)}>
          {label}
          {opsional ? ' (opsional)' : ''}
        </label>
        {galat ? (
          <CircleAlert size={16} className={styles.ikonSalah} aria-hidden="true" />
        ) : valid ? (
          <CircleCheck size={16} className={styles.ikonBenar} aria-hidden="true" />
        ) : null}
      </div>
      {children}
      {hint && (
        <span id={`${idField(k)}-hint`} className="form-hint">
          {hint}
        </span>
      )}
      {galat && (
        <span id={`${idField(k)}-galat`} className={styles.galat}>
          {galat}
        </span>
      )}
      {tambahan}
    </div>
  );
}

interface WalkinPanelProps {
  /** Fokuskan isian Nama saat panel pertama tampil. Matikan bila panel dibuka lewat tab agar fokus tetap di tombol tab. */
  fokusAwal?: boolean;
}

export default function WalkinPanel({ fokusAwal = true }: WalkinPanelProps) {
  const router = useRouter();
  const [form, setForm] = useState<DataWalkin>(WALKIN_KOSONG);
  const [disentuh, setDisentuh] = useState<Partial<Record<keyof DataWalkin, boolean>>>({});
  const [sudahCoba, setSudahCoba] = useState(false);
  const [ringkasan, setRingkasan] = useState<number | null>(null);
  const [umpan, setUmpan] = useState<Umpan | null>(null);
  const [galatServerField, setGalatServerField] = useState<GalatFieldServer | null>(null);
  const [mengirim, setMengirim] = useState(false);
  const [layanan, setLayanan] = useState<LayananOpsi[]>([]);
  const [asalSaran, setAsalSaran] = useState<string[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [lama, setLama] = useState<{ kunci: string; data: PengunjungLama } | null>(null);
  const [lamaDitutup, setLamaDitutup] = useState<string | null>(null);
  // Guard sinkron: klik ganda sebelum re-render tidak boleh mengirim dua kali.
  const kirimRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const umpanRef = useRef<HTMLDivElement>(null);
  // client_request_id dibuat SEKALI per percobaan dan dipakai ulang saat retry dengan data yang sama
  // (kontrak §2.1). Bila isian diubah, id baru dibuat supaya data baru tidak "tertimpa" kunjungan lama.
  const idRef = useRef<{ id: string; kunci: string } | null>(null);

  const galatSemua = useMemo(() => validasiWalkin(form), [form]);
  const daftarSalah = URUTAN_FIELD_WALKIN.filter((k) => galatSemua[k]);
  const jumlahBenar = URUTAN_FIELD_WALKIN.length - daftarSalah.length;
  // Galat baru tampil setelah isian disentuh (blur) atau setelah kirim dicoba.
  // Galat per-isian dari server (error.details) tampil sampai isian itu diubah.
  const galatDi = (k: keyof DataWalkin) =>
    (disentuh[k] || sudahCoba ? galatSemua[k] : undefined) ?? (galatServerField?.field === k ? galatServerField.pesan : undefined);
  // Isian opsional yang dikosongkan (email) tidak diberi tanda "benar".
  const validDi = (k: keyof DataWalkin) => Boolean(disentuh[k]) && !galatDi(k) && (k !== 'email' || form.email.trim() !== '');

  const hpKunci = !periksaHp(form.kontak_hp) ? normalisasiHp(form.kontak_hp) : '';
  const emailKunci = !periksaEmail(form.email) ? normalisasiEmail(form.email) : '';
  const kunciCari = `${hpKunci}|${emailKunci}`;

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
        // daftar layanan gagal dimuat: opsi "Belum tahu" tetap tersedia, form tetap bisa dipakai
      }
      const asal = await muatAsalSering(supabase);
      if (aktif) setAsalSaran(asal);
    })();
    return () => {
      aktif = false;
    };
  }, []);

  // Fokus otomatis ke isian pertama (hanya saat halaman dibuka, bukan saat berpindah tab: fokus tetap di tab).
  useEffect(() => {
    if (fokusAwal) document.getElementById(idField('nama'))?.focus();
    // sengaja hanya saat mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cari pengunjung lama (debounce). Gagal/tidak ada = diam-diam tanpa banner.
  useEffect(() => {
    if (kunciCari === '|') return;
    let batal = false;
    const [hp, email] = kunciCari.split('|');
    const t = setTimeout(() => {
      void cariPengunjungLama(createClient(), { hp: hp || null, email: email || null }).then((data) => {
        if (!batal && data) setLama({ kunci: kunciCari, data });
      });
    }, JEDA_CARI_PENGUNJUNG_MS);
    return () => {
      batal = true;
      clearTimeout(t);
    };
  }, [kunciCari]);

  // Umpan hasil kirim (galat server / info offline) muncul di dekat tombol kirim: bawa ke layar dan fokuskan.
  useEffect(() => {
    if (!umpan) return;
    const el = umpanRef.current;
    if (umpan.field) {
      // Galat per-isian dari server: tandai dan fokuskan isian itu (alert di dekat tombol tetap menjelaskan).
      fokusField(umpan.field);
      return;
    }
    if (!el) return;
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    el.focus({ preventScroll: true });
  }, [umpan]);

  const ubah = useCallback(<K extends keyof DataWalkin>(k: K, v: DataWalkin[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setGalatServerField((g) => (g?.field === k ? null : g));
  }, []);

  /** Saat blur: tandai disentuh dan rapikan nilai (nama, HP, email, spasi). */
  const selesaiIsi = (k: keyof DataWalkin) => {
    setDisentuh((d) => (d[k] ? d : { ...d, [k]: true }));
    setForm((f) => {
      const v = f[k];
      let baru = v;
      if (k === 'nama') baru = rapikanNama(v);
      else if (k === 'asal_instansi' || k === 'keperluan') baru = v.trim();
      else if (k === 'email') baru = normalisasiEmail(v);
      else if (k === 'kontak_hp') baru = periksaHp(v) ? v.trim() : formatHpTampil(normalisasiHp(v));
      return baru === v ? f : { ...f, [k]: baru };
    });
  };

  const enterPindah = (k: keyof DataWalkin) => (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    const berikut = URUTAN_FIELD_WALKIN[URUTAN_FIELD_WALKIN.indexOf(k) + 1];
    if (berikut) fokusField(berikut);
  };

  const simpanOffline = async (param: ParamFoMulai) => {
    if (!userId) throw new Error('tanpa pemilik');
    // Aturan yang sama dengan formulir: item yang pasti ditolak server tidak boleh masuk antrean.
    if (Object.keys(validasiParamFoMulai(param)).length > 0) throw new Error('data tidak valid');
    await enqueueAction({ type: 'fo_walkin', payload: { ...param }, owner_user_id: userId });
    void daftarkanSyncOffline();
    idRef.current = null;
    setForm(WALKIN_KOSONG);
    setDisentuh({});
    setSudahCoba(false);
    setUmpan({
      jenis: 'info',
      teks: 'Koneksi terputus: pendaftaran disimpan di perangkat ini dan akan dikirim otomatis saat koneksi kembali. Pengunjung belum tercatat di server.',
    });
  };

  const isiOtomatis = () => {
    if (!lama || lama.kunci !== kunciCari) return;
    const d = lama.data;
    const baru: DataWalkin = {
      ...form,
      nama: d.nama,
      asal_instansi: d.asal_instansi,
      kategori: d.kategori || form.kategori,
      email: form.email.trim() ? form.email : d.email || form.email,
      kontak_hp: form.kontak_hp.trim() ? form.kontak_hp : d.kontak_hp ? formatHpTampil(normalisasiHp(d.kontak_hp)) : form.kontak_hp,
    };
    setForm(baru);
    setDisentuh((t) => ({ ...t, nama: true, asal_instansi: true, kategori: Boolean(d.kategori) || t.kategori }));
    setLamaDitutup(lama.kunci);
    const salah = validasiWalkin(baru);
    const pertama = URUTAN_FIELD_WALKIN.find((k) => salah[k]);
    if (pertama) fokusField(pertama);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (kirimRef.current) return;
    setUmpan(null);
    setGalatServerField(null);
    setSudahCoba(true);

    const salah = validasiWalkin(form);
    const pertama = URUTAN_FIELD_WALKIN.find((k) => salah[k]);
    if (pertama) {
      setRingkasan(Object.keys(salah).length);
      fokusField(pertama);
      return;
    }
    setRingkasan(null);

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
            setUmpan({ jenis: 'galat', teks: `${PESAN_GALAT_JARINGAN} Pendaftaran belum tersimpan, jangan tutup halaman ini.` });
          }
          return;
        }
        await panggilFoMulaiKunjungan(createClient(), param);
        idRef.current = null;
        setForm(WALKIN_KOSONG);
        setDisentuh({});
        setSudahCoba(false);
        setUmpan({ jenis: 'info', teks: 'Kunjungan terdaftar. Membuka halaman Penanganan…' });
        router.push('/admin/fo/penanganan');
      } catch (err) {
        if (err instanceof GalatRpc && err.jaringan) {
          // Hasil di server tidak diketahui; aman menyimpan offline karena id yang sama bersifat idempoten.
          try {
            await simpanOffline(param);
          } catch {
            setUmpan({ jenis: 'galat', teks: PESAN_GALAT_JARINGAN });
          }
        } else {
          const perField = galatFieldServer(err);
          if (perField) setGalatServerField(perField);
          setUmpan({
            jenis: 'galat',
            teks: perField ? `Isian ${LABEL_FIELD_WALKIN[perField.field]} ditolak server. ${perField.pesan}` : pesanGalatFoMulai(err),
            sesiBerakhir: err instanceof GalatRpc && err.kode === 'SESI_TIDAK_SAH',
            field: perField?.field,
          });
        }
      }
    } finally {
      kirimRef.current = false;
      setMengirim(false);
    }
  };

  /** Atribut umum kontrol: id, wajib, status galat, dan hubungan ke petunjuk/galat. */
  const atribut = (k: keyof DataWalkin, adaHint: boolean, wajib = true) => {
    const galat = galatDi(k);
    const desc = [adaHint ? `${idField(k)}-hint` : null, galat ? `${idField(k)}-galat` : null].filter(Boolean).join(' ');
    return {
      id: idField(k),
      required: wajib,
      'aria-required': wajib,
      'aria-invalid': galat ? (true as const) : undefined,
      'aria-describedby': desc || undefined,
      onBlur: () => selesaiIsi(k),
    };
  };

  const saranEmail = disentuh.email && !galatSemua.email ? sarankanEmail(form.email) : null;
  const lamaTampil =
    lama && lama.kunci === kunciCari && lamaDitutup !== kunciCari
      ? lama.data
      : null;
  const lamaHariIni = lamaTampil?.tanggal === todayWIB();
  const keperluanPanjang = Array.from(form.keperluan.trim()).length;

  return (
    <>
      <div className={styles.halaman}>
        <p className={styles.pengantar}>
          Semua isian bertanda <span className={styles.bintang} aria-hidden="true">*</span> wajib diisi agar data
          pengunjung lengkap.
        </p>

        <form ref={formRef} onSubmit={handleSubmit} noValidate className={styles.form}>
          <fieldset className={styles.kunci} disabled={mengirim}>
            <legend className={styles.srOnly}>Formulir pendaftaran pengunjung walk-in</legend>

            <section className={styles.bagian} aria-labelledby="fo-bagian-data">
              <h2 id="fo-bagian-data" className={styles.judulBagian}>
                <User size={18} aria-hidden="true" /> Data Pengunjung
              </h2>
              <div className={styles.grid}>
                <Kolom
                  k="nama"
                  label="Nama Lengkap"
                  hint="Sesuai identitas. Huruf besar/kecil dirapikan otomatis."
                  galat={galatDi('nama')}
                  valid={validDi('nama')}
                >
                  <input
                    {...atribut('nama', true)}
                    type="text"
                    className="form-input"
                    value={form.nama}
                    onChange={(e) => ubah('nama', e.target.value)}
                    onKeyDown={enterPindah('nama')}
                    maxLength={BATAS_WALKIN.namaMax}
                    autoComplete="off"
                    autoCapitalize="words"
                    spellCheck={false}
                  />
                </Kolom>

                <Kolom
                  k="asal_instansi"
                  label="Asal / Instansi"
                  hint="Nama perusahaan, instansi, atau daerah asal."
                  galat={galatDi('asal_instansi')}
                  valid={validDi('asal_instansi')}
                >
                  <input
                    {...atribut('asal_instansi', true)}
                    type="text"
                    className="form-input"
                    placeholder="Contoh: PT Lampung Berjaya / Kedaton"
                    value={form.asal_instansi}
                    onChange={(e) => ubah('asal_instansi', e.target.value)}
                    onKeyDown={enterPindah('asal_instansi')}
                    maxLength={BATAS_WALKIN.asalMax}
                    autoComplete="off"
                    list="fo-asal-saran"
                  />
                  <datalist id="fo-asal-saran">
                    {asalSaran.map((a) => (
                      <option key={a} value={a} />
                    ))}
                  </datalist>
                </Kolom>

                <Kolom
                  k="kategori"
                  label="Kategori Pengunjung"
                  galat={galatDi('kategori')}
                  valid={validDi('kategori')}
                  penuh
                >
                  <select
                    {...atribut('kategori', false)}
                    className="form-select"
                    value={form.kategori}
                    onChange={(e) => ubah('kategori', e.target.value)}
                  >
                    <option value="">— Pilih kategori —</option>
                    {KATEGORI_WALKIN.map((k) => (
                      <option key={k} value={k}>
                        {KATEGORI_PENGUNJUNG[k]}
                      </option>
                    ))}
                  </select>
                </Kolom>
              </div>
            </section>

            <section className={styles.bagian} aria-labelledby="fo-bagian-kontak">
              <h2 id="fo-bagian-kontak" className={styles.judulBagian}>
                <Phone size={18} aria-hidden="true" /> Kontak
              </h2>
              <div className={styles.grid}>
                <Kolom
                  k="kontak_hp"
                  label="Nomor HP"
                  hint="Boleh 08…, +62 8…, atau 62 8…; spasi dan tanda hubung diabaikan."
                  galat={galatDi('kontak_hp')}
                  valid={validDi('kontak_hp')}
                >
                  <input
                    {...atribut('kontak_hp', true)}
                    type="tel"
                    inputMode="tel"
                    className="form-input"
                    placeholder="0812-3456-7890"
                    value={form.kontak_hp}
                    onChange={(e) => ubah('kontak_hp', e.target.value)}
                    onKeyDown={enterPindah('kontak_hp')}
                    maxLength={24}
                    autoComplete="off"
                  />
                </Kolom>

                <Kolom
                  k="email"
                  label="Email"
                  opsional
                  hint="Opsional. Bila diisi, alamat email aktif pengunjung."
                  galat={galatDi('email')}
                  valid={validDi('email')}
                  tambahan={
                    saranEmail ? (
                      <div className={styles.saran} role="status">
                        <span>
                          Maksud Anda <strong>{saranEmail}</strong>?
                        </span>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => {
                            ubah('email', saranEmail);
                            fokusField('email');
                          }}
                        >
                          Pakai {saranEmail}
                        </button>
                      </div>
                    ) : null
                  }
                >
                  <input
                    {...atribut('email', true, false)}
                    type="email"
                    inputMode="email"
                    className="form-input"
                    placeholder="nama@gmail.com"
                    value={form.email}
                    onChange={(e) => ubah('email', e.target.value)}
                    onKeyDown={enterPindah('email')}
                    maxLength={BATAS_WALKIN.emailMax}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                  />
                </Kolom>
              </div>

              <div aria-live="polite">
                {lamaTampil && (
                  <div className={styles.banner}>
                    <History size={18} className={styles.bannerIkon} aria-hidden="true" />
                    <div className={styles.bannerIsi}>
                      <p className={styles.bannerTeks}>
                        Pernah berkunjung sebagai <strong>{lamaTampil.nama}</strong> ({lamaTampil.asal_instansi})
                        {lamaTampil.tanggal ? `, terakhir ${formatTanggalId(lamaTampil.tanggal)}` : ''}. Isi otomatis?
                      </p>
                      {lamaHariIni && (
                        <p className={styles.bannerPeringatan}>
                          Nomor/email ini juga sudah tercatat hari ini. Pastikan bukan pendaftaran ganda.
                        </p>
                      )}
                      <div className={styles.bannerAksi}>
                        <button type="button" className="btn btn--primary btn--sm" onClick={isiOtomatis}>
                          Isi otomatis
                        </button>
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setLamaDitutup(kunciCari)}>
                          Abaikan
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section className={styles.bagian} aria-labelledby="fo-bagian-perlu">
              <h2 id="fo-bagian-perlu" className={styles.judulBagian}>
                <ClipboardList size={18} aria-hidden="true" /> Keperluan &amp; Tujuan
              </h2>
              <div className={styles.grid}>
                <Kolom
                  k="layanan_saran_id"
                  label="Layanan Saran"
                  hint="Saran tujuan eskalasi, bukan tiket. Pilih “Belum tahu” bila belum jelas."
                  galat={galatDi('layanan_saran_id')}
                  valid={validDi('layanan_saran_id')}
                  penuh
                >
                  <select
                    {...atribut('layanan_saran_id', true)}
                    className="form-select"
                    value={form.layanan_saran_id}
                    onChange={(e) => ubah('layanan_saran_id', e.target.value)}
                  >
                    <option value="">— Pilih layanan saran —</option>
                    <option value={LAYANAN_BELUM_TAHU}>Belum tahu — ditentukan saat eskalasi</option>
                    {layanan.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.nama}
                      </option>
                    ))}
                  </select>
                </Kolom>

                <Kolom
                  k="keperluan"
                  label="Keperluan"
                  hint="Jelaskan singkat keperluan kunjungan (10–500 karakter). Ctrl+Enter untuk mendaftarkan."
                  galat={galatDi('keperluan')}
                  valid={validDi('keperluan')}
                  penuh
                  tambahan={
                    <span className={styles.counter} aria-hidden="true">
                      {form.keperluan.length}/{BATAS_WALKIN.keperluanMax}
                      {keperluanPanjang > 0 && keperluanPanjang < BATAS_WALKIN.keperluanMin
                        ? ` · kurang ${BATAS_WALKIN.keperluanMin - keperluanPanjang} karakter`
                        : ''}
                    </span>
                  }
                >
                  <textarea
                    {...atribut('keperluan', true)}
                    className="form-textarea"
                    rows={4}
                    placeholder="Contoh: Mengurus NIB dan perizinan berusaha untuk usaha kuliner"
                    value={form.keperluan}
                    onChange={(e) => ubah('keperluan', e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        formRef.current?.requestSubmit();
                      }
                    }}
                    maxLength={BATAS_WALKIN.keperluanMax}
                  />
                </Kolom>
              </div>
            </section>
          </fieldset>

          <div className={styles.umpanZona}>
            <div role="status" aria-live="polite">
              {umpan?.jenis === 'info' && (
                <div ref={umpanRef} tabIndex={-1} className={styles.notice}>
                  {umpan.teks}
                </div>
              )}
            </div>
            {umpan?.jenis === 'galat' && (
              <div ref={umpanRef} tabIndex={-1} role="alert" className={styles.galatServer}>
                {umpan.teks}
                {umpan.sesiBerakhir && (
                  <>
                    {' '}
                    <Link href={urlLoginAlasan('tidak_terdaftar')}>Masuk kembali</Link>
                  </>
                )}
              </div>
            )}
            {!umpan && ringkasan !== null && daftarSalah.length > 0 && (
              <div className={styles.galatServer}>
                <p role="alert" className={styles.ringkasanJudul}>
                  Lengkapi {ringkasan} isian yang belum benar sebelum mendaftarkan:
                </p>
                <ul className={styles.ringkasanDaftar}>
                  {daftarSalah.map((k) => (
                    <li key={k}>
                      <button type="button" className={styles.tautanField} onClick={() => fokusField(k)}>
                        {LABEL_FIELD_WALKIN[k]}
                      </button>
                      : {galatSemua[k]}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className={styles.aksi}>
            <p className={styles.kemajuan}>
              {jumlahBenar} dari {URUTAN_FIELD_WALKIN.length} isian sudah benar
            </p>
            <button type="submit" className={`btn btn--primary btn--lg ${styles.kirim}`} disabled={mengirim} aria-busy={mengirim}>
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
    </>
  );
}
