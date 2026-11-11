'use client';

import Field from '@/components/ui/Field';

import Tombol from '@/components/ui/Tombol';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, CheckCircle, Loader2, Save, KeyRound } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import IsiHalaman from '@/components/layout/IsiHalaman';
import Galat from '@/components/ui/Galat';
import Skeleton from '@/components/ui/Skeleton';
import Kartu from '@/components/ui/Kartu';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';
import { isSyntheticEmail, normalizeNoHp } from '@/lib/akun/login';
import styles from './profil.module.css';

interface Profil {
  id: string;
  nama: string;
  username: string | null;
  role: 'admin' | 'petugas' | 'front_office';
  layanan_nama: string | null;
  no_hp: string | null;
  email_notifikasi: string | null;
  email_notifikasi_terverifikasi: boolean;
  operator_default: string | null;
  /** Diatur Admin di Kelola Akun. Tidak ada sebelum migrasi 202611030014 diterapkan (dianggap false). */
  operator_aktif?: boolean;
  wajib_ganti_sandi: boolean;
}

type Bagian = 'diri' | 'email' | 'operator';

/** Galat dari server; `field` menunjuk isian yang bermasalah (kontrak PROFIL-DB). */
class GalatApi extends Error {
  field?: string;
  constructor(pesan: string, field?: string) {
    super(pesan);
    this.field = field;
  }
}

interface Umpan {
  tipe: 'ok' | 'peringatan';
  teks: string;
}

// Sandi SUDAH berubah tetapi penanda wajib-ganti gagal dibersihkan: pengguna masih login dan sandi barunya berlaku.
const PESAN_SANDI_BERLAKU_FLAG_GAGAL =
  'Kata sandi baru Anda sudah berlaku, tetapi status wajib-ganti belum bersih. Muat ulang halaman; bila masih diminta mengganti sandi, hubungi Admin.';

const PESAN_OFFLINE = 'Tidak ada koneksi internet. Periksa jaringan Anda, lalu coba lagi.';

const ROLE_LABEL = { admin: 'Admin', petugas: 'Petugas', front_office: 'Front Office' } as const;

/** fetch yang mengubah kegagalan jaringan menjadi pesan Indonesia dan galat server menjadi GalatApi. */
async function panggil(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new GalatApi(PESAN_OFFLINE);
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new GalatApi(
      typeof json.error === 'string' ? json.error : 'Permintaan gagal. Coba lagi.',
      typeof json.field === 'string' ? json.field : undefined,
    );
  }
  return json;
}

const pesanGalat = (e: unknown, cadangan: string) => (e instanceof Error && e.message ? e.message : cadangan);

function periksaNama(mentah: string): string | null {
  const v = mentah.trim();
  if (!v) return 'Nama wajib diisi.';
  if (v.length < 2 || v.length > 100) return 'Nama 2 sampai 100 karakter.';
  if (/[\u0000-\u001f\u007f]/.test(v)) return 'Nama tidak boleh memuat karakter kontrol.';
  if (/^[=+\-@]/.test(v)) return 'Nama tidak boleh diawali tanda =, +, - atau @.';
  return null;
}

/** Nomor HP yang akan dikirim: '' (kosong), bentuk +62 bila valid, atau teks apa adanya bila tidak valid. */
function bentukHp(mentah: string): { nilai: string; valid: boolean } {
  const v = mentah.trim();
  if (!v) return { nilai: '', valid: true };
  const n = normalizeNoHp(v);
  return n ? { nilai: n, valid: true } : { nilai: v, valid: false };
}

function periksaEmail(mentah: string): string | null {
  const v = mentah.trim().toLowerCase();
  if (!v) return null;
  if (isSyntheticEmail(v)) {
    return 'Alamat itu adalah alamat masuk akun, bukan email sungguhan. Gunakan email yang dapat Anda buka.';
  }
  if (v.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Format email tidak valid. Contoh: nama@instansi.go.id.';
  return null;
}

function ProfilContent() {
  const { toast } = useToast();
  const params = useSearchParams();
  // ?wajib=1 = datang dari tautan pemulihan (sesi recovery: sandi lama tidak diminta).
  const recovery = params.get('wajib') === '1';
  const emailVerif = params.get('email_verif');
  const paksaGanti = params.get('ganti') === '1';

  const [profil, setProfil] = useState<Profil | null>(null);
  const [loadError, setLoadError] = useState('');
  const [memuatUlang, setMemuatUlang] = useState(false);

  const [nama, setNama] = useState('');
  const [noHp, setNoHp] = useState('');
  const [emailNotif, setEmailNotif] = useState('');
  const [operator, setOperator] = useState('');
  const [menyimpan, setMenyimpan] = useState<Bagian | null>(null);
  const [galatField, setGalatField] = useState<Partial<Record<'nama' | 'no_hp' | 'email_notifikasi' | 'operator_default', string>>>({});
  const [galatBagian, setGalatBagian] = useState<Partial<Record<Bagian, string>>>({});
  const [umpan, setUmpan] = useState<Partial<Record<Bagian, Umpan>>>({});
  const [resending, setResending] = useState(false);

  const [sandiLama, setSandiLama] = useState('');
  const [sandiBaru, setSandiBaru] = useState('');
  const [sandiUlang, setSandiUlang] = useState('');
  const [keluarkan, setKeluarkan] = useState(true);
  const [sandiError, setSandiError] = useState('');
  const [sandiSaving, setSandiSaving] = useState(false);
  const sandiAwalRef = useRef<HTMLInputElement>(null);

  /** Menyalin nilai server ke isian; `bagian` membatasi isian mana yang diatur ulang agar ketikan bagian lain tidak hilang. */
  const terapkan = useCallback((p: Profil, bagian?: Bagian) => {
    setProfil(p);
    if (!bagian || bagian === 'diri') {
      setNama(p.nama);
      setNoHp(p.no_hp ?? '');
    }
    if (!bagian || bagian === 'email') setEmailNotif(p.email_notifikasi ?? '');
    if (!bagian || bagian === 'operator') setOperator(p.operator_default ?? '');
  }, []);

  const load = useCallback(async () => {
    try {
      const json = await panggil('/api/me/profil');
      terapkan(json.profil as Profil);
      setLoadError('');
    } catch (e) {
      setLoadError(pesanGalat(e, 'Gagal memuat profil'));
    }
  }, [terapkan]);

  useEffect(() => {
    load();
  }, [load]);

  const sandiDiutamakan = !!profil && (profil.wajib_ganti_sandi || paksaGanti || recovery);
  useEffect(() => {
    if (sandiDiutamakan) sandiAwalRef.current?.focus();
  }, [sandiDiutamakan]);

  const coba = async () => {
    setMemuatUlang(true);
    await load();
    setMemuatUlang(false);
  };

  const mulaiSimpan = (b: Bagian) => {
    setMenyimpan(b);
    setGalatBagian((g) => ({ ...g, [b]: undefined }));
    setUmpan((u) => ({ ...u, [b]: undefined }));
  };

  /** Kirim patch, lalu terapkan profil terbaru dari server (atau muat ulang bila server tidak mengirimnya). */
  const kirimPatch = async (b: Bagian, patch: Record<string, string | null>) => {
    mulaiSimpan(b);
    try {
      const json = await panggil('/api/me/profil', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (json.profil) terapkan(json.profil as Profil, b);
      else {
        const baru = await panggil('/api/me/profil');
        terapkan(baru.profil as Profil, b);
      }
      return json;
    } catch (err) {
      const teks = pesanGalat(err, 'Gagal menyimpan. Coba lagi.');
      const field = err instanceof GalatApi ? err.field : undefined;
      if (field === 'nama' || field === 'no_hp' || field === 'email_notifikasi' || field === 'operator_default') {
        setGalatField((g) => ({ ...g, [field]: teks }));
      } else {
        setGalatBagian((g) => ({ ...g, [b]: teks }));
      }
      return null;
    } finally {
      setMenyimpan(null);
    }
  };

  const simpanDiri = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profil) return;
    setGalatField((g) => ({ ...g, nama: undefined, no_hp: undefined }));
    const patch: Record<string, string | null> = {};
    const errNama = periksaNama(nama);
    const hp = bentukHp(noHp);
    const salah: typeof galatField = {};
    if (nama.trim() !== profil.nama) {
      if (errNama) salah.nama = errNama;
      else patch.nama = nama.trim();
    }
    if (hp.nilai !== (profil.no_hp ?? '')) {
      if (!hp.valid) salah.no_hp = 'Nomor HP tidak valid. Contoh: 0812 3456 7890.';
      else patch.no_hp = hp.nilai || null;
    }
    if (Object.keys(salah).length > 0) {
      setGalatField((g) => ({ ...g, ...salah }));
      return;
    }
    if (Object.keys(patch).length === 0) return;
    const json = await kirimPatch('diri', patch);
    if (json) setUmpan((u) => ({ ...u, diri: { tipe: 'ok', teks: 'Data diri tersimpan.' } }));
  };

  const simpanEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profil) return;
    setGalatField((g) => ({ ...g, email_notifikasi: undefined }));
    const baru = emailNotif.trim().toLowerCase();
    if (baru === (profil.email_notifikasi ?? '')) return;
    const err = periksaEmail(baru);
    if (err) {
      setGalatField((g) => ({ ...g, email_notifikasi: err }));
      return;
    }
    const json = await kirimPatch('email', { email_notifikasi: baru || null });
    if (!json) return;
    if (!baru) {
      setUmpan((u) => ({ ...u, email: { tipe: 'ok', teks: 'Email notifikasi dihapus.' } }));
    } else if (json.verifikasi_dikirim === true) {
      setUmpan((u) => ({
        ...u,
        email: { tipe: 'ok', teks: `Tautan verifikasi dikirim ke ${baru}. Tautan berlaku 30 menit.` },
      }));
    } else {
      setUmpan((u) => ({
        ...u,
        email: {
          tipe: 'peringatan',
          teks: 'Email tersimpan, tetapi tautan verifikasi belum terkirim. Periksa alamatnya, lalu kirim ulang tautan.',
        },
      }));
    }
  };

  const simpanOperator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profil) return;
    setGalatField((g) => ({ ...g, operator_default: undefined }));
    const baru = operator.trim();
    if (baru === (profil.operator_default ?? '')) return;
    if (baru && (baru.length < 2 || baru.length > 100)) {
      setGalatField((g) => ({ ...g, operator_default: 'Nama 2 sampai 100 karakter.' }));
      return;
    }
    const json = await kirimPatch('operator', { operator_default: baru || null });
    if (json) setUmpan((u) => ({ ...u, operator: { tipe: 'ok', teks: 'Nama operator tersimpan.' } }));
  };

  const handleKirimUlang = async () => {
    setResending(true);
    setGalatBagian((g) => ({ ...g, email: undefined }));
    setUmpan((u) => ({ ...u, email: undefined }));
    try {
      await panggil('/api/me/email-verifikasi', { method: 'POST' });
      setUmpan((u) => ({ ...u, email: { tipe: 'ok', teks: 'Tautan verifikasi dikirim ulang. Tautan berlaku 30 menit.' } }));
    } catch (err) {
      setGalatBagian((g) => ({ ...g, email: pesanGalat(err, 'Gagal mengirim tautan verifikasi.') }));
    } finally {
      setResending(false);
    }
  };

  const handleSandi = async (e: React.FormEvent) => {
    e.preventDefault();
    setSandiError('');
    if (sandiBaru.length < 8 || sandiBaru.length > 72) {
      setSandiError('Kata sandi baru 8 sampai 72 karakter.');
      return;
    }
    if (sandiBaru !== sandiUlang) {
      setSandiError('Konfirmasi kata sandi tidak sama.');
      return;
    }
    if (!recovery && !sandiLama) {
      setSandiError('Kata sandi lama wajib diisi.');
      return;
    }
    if (!recovery && sandiBaru === sandiLama) {
      setSandiError('Kata sandi baru harus berbeda dari yang lama.');
      return;
    }
    setSandiSaving(true);
    try {
      const sandiSudahBerlaku = () => {
        // Jangan biarkan sandi (lama/baru) menggantung di form dan jangan suruh mencoba lagi dengan sandi lama.
        setSandiLama('');
        setSandiBaru('');
        setSandiUlang('');
        setSandiError(PESAN_SANDI_BERLAKU_FLAG_GAGAL);
        toast(PESAN_SANDI_BERLAKU_FLAG_GAGAL, 'warning');
      };
      if (recovery) {
        const { error } = await createClient().auth.updateUser({ password: sandiBaru });
        if (error) throw new Error('Gagal mengganti kata sandi. Tautan pemulihan mungkin sudah kedaluwarsa.');
        // Bersihkan penanda "wajib ganti sandi" (kontrak RBAC akhir §4).
        const done = await fetch('/api/me/sandi-selesai', { method: 'POST' });
        if (!done.ok) {
          sandiSudahBerlaku();
          return;
        }
      } else {
        const res = await fetch('/api/me/sandi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sandi_lama: sandiLama, sandi_baru: sandiBaru, keluarkan_perangkat_lain: keluarkan }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (json.kode === 'SANDI_BERUBAH_FLAG_GAGAL') {
            sandiSudahBerlaku();
            return;
          }
          throw new Error(json.error ?? 'Gagal mengganti kata sandi');
        }
      }
      setSandiLama('');
      setSandiBaru('');
      setSandiUlang('');
      toast('Kata sandi berhasil diganti.', 'success');
      await load();
    } catch (err) {
      setSandiError(
        err instanceof TypeError ? PESAN_OFFLINE : err instanceof Error ? err.message : 'Gagal mengganti kata sandi',
      );
    } finally {
      setSandiSaving(false);
    }
  };

  if (loadError && !profil) {
    return (
      <>
        <PageHeader title="Profil Saya" />
        <IsiHalaman lebar="baca">
          <div className={styles.container}>
            <Galat pesan={loadError} onRetry={coba} memuat={memuatUlang} />
          </div>
        </IsiHalaman>
      </>
    );
  }

  if (!profil) {
    return (
      <>
        <PageHeader title="Profil Saya" />
        <IsiHalaman lebar="baca">
          <div className={styles.container} role="status" aria-label="Memuat profil">
            <Skeleton bentuk="kartu" jumlah={2} label="Memuat profil" />
          </div>
        </IsiHalaman>
      </>
    );
  }

  const wajibGanti = profil.wajib_ganti_sandi || paksaGanti;
  const adaEmail = !!profil.email_notifikasi;
  const hpDiketik = bentukHp(noHp);

  const diriBerubah = nama.trim() !== profil.nama || hpDiketik.nilai !== (profil.no_hp ?? '');
  const emailBerubah = emailNotif.trim().toLowerCase() !== (profil.email_notifikasi ?? '');
  const operatorBerubah = operator.trim() !== (profil.operator_default ?? '');

  const tombolSimpan = (b: Bagian, berubah: boolean) => (
    <Tombol type="submit" varian="utama" disabled={!berubah || menyimpan !== null}>
      {menyimpan === b ? <Loader2 size={16} className="animate-pulse" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}{' '}
      Simpan
    </Tombol>
  );

  const pesanBagian = (b: Bagian) => (
    <>
      {galatBagian[b] && <p className="form-error" role="alert">{galatBagian[b]}</p>}
      {umpan[b] && (
        <p className={umpan[b]!.tipe === 'ok' ? styles.umpanOk : styles.umpanPeringatan} role="status">
          {umpan[b]!.teks}
        </p>
      )}
    </>
  );

  const blokKeamanan = (
    <Kartu className={styles.card}><form key="keamanan" className={styles.form} onSubmit={handleSandi} aria-labelledby="sandi-judul">
      <div>
        <h2 id="sandi-judul" className={styles.cardTitle}>Keamanan</h2>
        <p className={styles.hint}>Ganti kata sandi akun Anda.</p>
      </div>
      {sandiError && <p className="form-error" role="alert">{sandiError}</p>}
      {recovery ? (
        <p className={styles.hint}>Anda masuk lewat tautan pemulihan. Tentukan kata sandi baru.</p>
      ) : (
        <Field label="Kata sandi lama" wajib>
          <input id="sandiLama" ref={sandiAwalRef} type="password" className="form-input" value={sandiLama}
          onChange={(e) => setSandiLama(e.target.value)} autoComplete="current-password" />
        </Field>
      )}
      <div className="form-group">
        <label className="form-label form-label--required" htmlFor="sandiBaru">Kata sandi baru</label>
        <input id="sandiBaru" ref={recovery ? sandiAwalRef : undefined} type="password" className="form-input" value={sandiBaru}
          onChange={(e) => setSandiBaru(e.target.value)} autoComplete="new-password" minLength={8} maxLength={72} />
        <p className={styles.hint}>8 sampai 72 karakter.</p>
      </div>
      <Field label="Ulangi kata sandi baru" wajib>
        <input id="sandiUlang" type="password" className="form-input" value={sandiUlang}
        onChange={(e) => setSandiUlang(e.target.value)} autoComplete="new-password" />
      </Field>
      {!recovery && (
        <label className={styles.check}>
          <input type="checkbox" checked={keluarkan} onChange={(e) => setKeluarkan(e.target.checked)} />
          Keluarkan dari perangkat lain
        </label>
      )}
      <div>
        <Tombol type="submit" varian="utama" disabled={sandiSaving}>
          {sandiSaving ? <Loader2 size={16} className="animate-pulse" aria-hidden="true" /> : <KeyRound size={16} aria-hidden="true" />} Ganti Kata Sandi
        </Tombol>
      </div>
    </form></Kartu>
  );

  return (
    <>
      <PageHeader title="Profil Saya" description="Data diri, email notifikasi, dan keamanan akun Anda" />

      <IsiHalaman lebar="baca">
        <div className={styles.container}>
          {loadError && <Galat pesan={loadError} onRetry={coba} memuat={memuatUlang} />}
          {wajibGanti && (
            <div className={`${styles.banner} ${styles.bannerWarn}`} role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>Anda memakai kata sandi sementara. Ganti kata sandi sekarang sebelum melanjutkan.</span>
            </div>
          )}
          {emailVerif === 'ok' && (
            <div className={`${styles.banner} ${styles.bannerOk}`} role="status">
              <CheckCircle size={16} aria-hidden="true" />
              <span>Email notifikasi berhasil diverifikasi.</span>
            </div>
          )}
          {emailVerif === 'gagal' && (
            <div className={`${styles.banner} ${styles.bannerWarn}`} role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>Verifikasi email gagal atau tautan sudah kedaluwarsa. Kirim ulang tautan verifikasi.</span>
            </div>
          )}

          <section className={styles.identitas} aria-labelledby="identitas-judul">
            <h2 id="identitas-judul" className={styles.nama}>{profil.nama}</h2>
            <p className={styles.username}>
              Nama pengguna <strong>{profil.username ?? 'belum ada'}</strong>
            </p>
            <div className={styles.lencanaBaris}>
              <span className={styles.lencana}>{ROLE_LABEL[profil.role]}</span>
              {profil.layanan_nama && <span className={styles.lencana}>{profil.layanan_nama}</span>}
            </div>
            <p className={styles.hint}>Nama pengguna, role, dan layanan hanya dapat diubah oleh Admin.</p>
          </section>

          {sandiDiutamakan && blokKeamanan}

          <Kartu className={styles.card}><form className={styles.form} onSubmit={simpanDiri} aria-labelledby="diri-judul" noValidate>
            <div>
              <h2 id="diri-judul" className={styles.cardTitle}>Data diri</h2>
              <p className={styles.hint}>Nama Anda tampil pada riwayat pelayanan, absensi, dan laporan.</p>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="nama">Nama</label>
              <input id="nama" type="text" className="form-input" value={nama} maxLength={100}
                onChange={(e) => setNama(e.target.value)} autoComplete="name"
                aria-invalid={galatField.nama ? true : undefined} aria-describedby={galatField.nama ? 'nama-galat' : undefined} />
              {galatField.nama && <p id="nama-galat" className="form-error" role="alert">{galatField.nama}</p>}
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="noHp">Nomor HP</label>
              <input id="noHp" type="tel" className="form-input" placeholder="0812 3456 7890" value={noHp}
                onChange={(e) => setNoHp(e.target.value)} autoComplete="tel"
                aria-invalid={galatField.no_hp ? true : undefined} aria-describedby={galatField.no_hp ? 'hp-galat' : 'hp-hint'} />
              {galatField.no_hp ? (
                <p id="hp-galat" className="form-error" role="alert">{galatField.no_hp}</p>
              ) : (
                <p id="hp-hint" className={styles.hint}>
                  {hpDiketik.valid && hpDiketik.nilai && hpDiketik.nilai !== noHp.trim()
                    ? `Akan disimpan sebagai ${hpDiketik.nilai}.`
                    : 'Boleh dikosongkan.'}
                </p>
              )}
            </div>
            {pesanBagian('diri')}
            <div>{tombolSimpan('diri', diriBerubah)}</div>
          </form></Kartu>

          <Kartu className={styles.card}><form className={styles.form} onSubmit={simpanEmail} aria-labelledby="email-judul" noValidate>
            <div>
              <div className={styles.judulBaris}>
                <h2 id="email-judul" className={styles.cardTitle}>Email notifikasi</h2>
                <span className={!adaEmail ? styles.lencana : profil.email_notifikasi_terverifikasi ? styles.lencanaOk : styles.lencanaPeringatan}>
                  {!adaEmail ? 'Belum diisi' : profil.email_notifikasi_terverifikasi ? 'Terverifikasi' : 'Belum terverifikasi'}
                </span>
              </div>
              <p className={styles.hint}>
                Dipakai untuk menerima notifikasi dan mengatur ulang kata sandi. Bukan untuk masuk. Mengubahnya
                memerlukan verifikasi ulang, dan satu alamat boleh dipakai beberapa akun.
              </p>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="emailNotif">Alamat email</label>
              <input id="emailNotif" type="email" className="form-input" placeholder="nama@instansi.go.id" value={emailNotif}
                onChange={(e) => setEmailNotif(e.target.value)} autoComplete="email"
                aria-invalid={galatField.email_notifikasi ? true : undefined}
                aria-describedby={galatField.email_notifikasi ? 'email-galat' : undefined} />
              {galatField.email_notifikasi && <p id="email-galat" className="form-error" role="alert">{galatField.email_notifikasi}</p>}
            </div>
            {pesanBagian('email')}
            <div className={styles.aksi}>
              {tombolSimpan('email', emailBerubah)}
              {adaEmail && !profil.email_notifikasi_terverifikasi && (
                <Tombol type="button" varian="sekunder" onClick={handleKirimUlang} disabled={resending}>
                  {resending ? <Loader2 size={16} className="animate-pulse" aria-hidden="true" /> : null} Kirim ulang verifikasi
                </Tombol>
              )}
            </div>
          </form></Kartu>

          {profil.operator_aktif && (
            <Kartu className={styles.card}><form className={styles.form} onSubmit={simpanOperator} aria-labelledby="operator-judul" noValidate>
              <div>
                <h2 id="operator-judul" className={styles.cardTitle}>Operator harian</h2>
                <p className={styles.hint}>
                  Diaktifkan Admin untuk akun ini. Nama di bawah otomatis tercatat pada absensi.
                </p>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="operator">Nama petugas yang bertugas hari ini</label>
                <input id="operator" type="text" className="form-input" value={operator} maxLength={100}
                  onChange={(e) => setOperator(e.target.value)}
                  aria-invalid={galatField.operator_default ? true : undefined}
                  aria-describedby={galatField.operator_default ? 'operator-galat' : undefined} />
                {galatField.operator_default && (
                  <p id="operator-galat" className="form-error" role="alert">{galatField.operator_default}</p>
                )}
              </div>
              {pesanBagian('operator')}
              <div>{tombolSimpan('operator', operatorBerubah)}</div>
            </form></Kartu>
          )}

          {!sandiDiutamakan && blokKeamanan}
        </div>
      </IsiHalaman>
    </>
  );
}

export default function ProfilPage() {
  return (
    <Suspense fallback={<Skeleton bentuk="kartu" jumlah={2} label="Memuat profil" />}>
      <ProfilContent />
    </Suspense>
  );
}
