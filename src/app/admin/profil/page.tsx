'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, CheckCircle, Loader2, Save, KeyRound } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';
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
  wajib_ganti_sandi: boolean;
}

const ROLE_LABEL = { admin: 'Admin', petugas: 'Petugas', front_office: 'Front Office' } as const;

function ProfilContent() {
  const { toast } = useToast();
  const params = useSearchParams();
  // ?wajib=1 = datang dari tautan pemulihan (sesi recovery: sandi lama tidak diminta).
  const recovery = params.get('wajib') === '1';
  const emailVerif = params.get('email_verif');
  const paksaGanti = params.get('ganti') === '1';

  const [profil, setProfil] = useState<Profil | null>(null);
  const [loadError, setLoadError] = useState('');
  const [noHp, setNoHp] = useState('');
  const [emailNotif, setEmailNotif] = useState('');
  const [operator, setOperator] = useState('');
  const [saving, setSaving] = useState(false);
  const [resending, setResending] = useState(false);

  const [sandiLama, setSandiLama] = useState('');
  const [sandiBaru, setSandiBaru] = useState('');
  const [sandiUlang, setSandiUlang] = useState('');
  const [keluarkan, setKeluarkan] = useState(true);
  const [sandiError, setSandiError] = useState('');
  const [sandiSaving, setSandiSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/me/profil');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Gagal memuat profil');
      const p = json.profil as Profil;
      setProfil(p);
      setNoHp(p.no_hp ?? '');
      setEmailNotif(p.email_notifikasi ?? '');
      setOperator(p.operator_default ?? '');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Gagal memuat profil');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const handleSimpan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profil) return;
    // Hanya kirim field yang berubah (kontrak: no_hp, email_notifikasi, operator_default).
    const patch: Record<string, string | null> = {};
    if (noHp.trim() !== (profil.no_hp ?? '')) patch.no_hp = noHp.trim() || null;
    if (emailNotif.trim() !== (profil.email_notifikasi ?? '')) patch.email_notifikasi = emailNotif.trim() || null;
    if (operator.trim() !== (profil.operator_default ?? '')) patch.operator_default = operator.trim() || null;
    if (Object.keys(patch).length === 0) {
      toast('Tidak ada perubahan.', 'info');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/me/profil', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Gagal menyimpan');
      toast(
        json.verifikasi_dikirim
          ? 'Profil disimpan. Tautan verifikasi dikirim ke email notifikasi (berlaku 30 menit).'
          : 'Profil disimpan.',
        'success',
      );
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleKirimUlang = async () => {
    setResending(true);
    try {
      const res = await fetch('/api/me/email-verifikasi', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Gagal mengirim');
      toast('Tautan verifikasi dikirim ulang.', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal mengirim', 'error');
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
      if (recovery) {
        const { error } = await createClient().auth.updateUser({ password: sandiBaru });
        if (error) throw new Error('Gagal mengganti kata sandi. Tautan pemulihan mungkin sudah kedaluwarsa.');
        // Bersihkan penanda "wajib ganti sandi" (kontrak RBAC akhir §4).
        const done = await fetch('/api/me/sandi-selesai', { method: 'POST' });
        if (!done.ok) throw new Error('Sandi berubah, tetapi status wajib-ganti belum bersih. Muat ulang halaman lalu coba lagi.');
      } else {
        const res = await fetch('/api/me/sandi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sandi_lama: sandiLama, sandi_baru: sandiBaru, keluarkan_perangkat_lain: keluarkan }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Gagal mengganti kata sandi');
      }
      setSandiLama('');
      setSandiBaru('');
      setSandiUlang('');
      toast('Kata sandi berhasil diganti.', 'success');
      await load();
    } catch (err) {
      setSandiError(err instanceof Error ? err.message : 'Gagal mengganti kata sandi');
    } finally {
      setSandiSaving(false);
    }
  };

  if (loadError) {
    return (
      <>
        <PageHeader title="Profil Saya" />
        <div className={styles.container}>
          <p className="form-error" role="alert">{loadError}</p>
        </div>
      </>
    );
  }

  if (!profil) {
    return (
      <>
        <PageHeader title="Profil Saya" />
        <div className={styles.container} role="status" aria-label="Memuat profil">
          <Loader2 size={24} className="animate-pulse" />
        </div>
      </>
    );
  }

  const emailBelumVerif = !!profil.email_notifikasi && !profil.email_notifikasi_terverifikasi;
  const wajibGanti = profil.wajib_ganti_sandi || paksaGanti;

  return (
    <>
      <PageHeader title="Profil Saya" description="Data akun, kontak notifikasi, dan kata sandi Anda" />

      <div className={styles.container}>
        {wajibGanti && (
          <div className={`${styles.banner} ${styles.bannerWarn}`} role="alert">
            <AlertTriangle size={16} />
            <span>Anda memakai kata sandi sementara. Ganti kata sandi sekarang sebelum melanjutkan.</span>
          </div>
        )}
        {emailVerif === 'ok' && (
          <div className={`${styles.banner} ${styles.bannerOk}`} role="status">
            <CheckCircle size={16} />
            <span>Email notifikasi berhasil diverifikasi.</span>
          </div>
        )}
        {emailVerif === 'gagal' && (
          <div className={`${styles.banner} ${styles.bannerWarn}`} role="alert">
            <AlertTriangle size={16} />
            <span>Verifikasi email gagal atau tautan sudah kedaluwarsa. Kirim ulang tautan verifikasi.</span>
          </div>
        )}
        {emailBelumVerif && (
          <div className={`${styles.banner} ${styles.bannerWarn}`} role="status">
            <AlertTriangle size={16} />
            <span>
              Email notifikasi <strong>{profil.email_notifikasi}</strong> belum terverifikasi. Notifikasi dan pemulihan
              sandi belum dapat dikirim ke alamat ini.
            </span>
            <button type="button" className="btn btn--secondary btn--sm" onClick={handleKirimUlang} disabled={resending}>
              {resending ? <Loader2 size={14} className="animate-pulse" /> : null} Kirim ulang verifikasi
            </button>
          </div>
        )}

        <section className={styles.card} aria-labelledby="akun-judul">
          <h2 id="akun-judul" className={styles.cardTitle}>Akun</h2>
          <dl className={styles.dl}>
            <dt>Nama</dt><dd>{profil.nama}</dd>
            <dt>Nama pengguna</dt><dd>{profil.username ?? '—'}</dd>
            <dt>Role</dt><dd>{ROLE_LABEL[profil.role]}</dd>
            <dt>Layanan</dt><dd>{profil.layanan_nama ?? '—'}</dd>
          </dl>
          <p className={styles.hint}>Nama, nama pengguna, role, dan layanan hanya dapat diubah oleh Admin.</p>
        </section>

        <form className={styles.card} onSubmit={handleSimpan} aria-labelledby="kontak-judul">
          <h2 id="kontak-judul" className={styles.cardTitle}>Kontak &amp; Notifikasi</h2>
          <div className="form-group">
            <label className="form-label" htmlFor="noHp">Nomor HP</label>
            <input id="noHp" type="tel" className="form-input" placeholder="08xxxxxxxxxx" value={noHp}
              onChange={(e) => setNoHp(e.target.value)} autoComplete="tel" />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="emailNotif">Email notifikasi</label>
            <input id="emailNotif" type="email" className="form-input" placeholder="nama@instansi.go.id" value={emailNotif}
              onChange={(e) => setEmailNotif(e.target.value)} autoComplete="email" />
            <p className={styles.hint}>
              {profil.email_notifikasi_terverifikasi
                ? 'Terverifikasi. Mengubah alamat ini memerlukan verifikasi ulang.'
                : 'Tautan verifikasi dikirim setelah disimpan.'}
            </p>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="operator">Nama petugas yang bertugas hari ini</label>
            <input id="operator" type="text" className="form-input" placeholder="Nama orang yang memakai akun ini" value={operator}
              onChange={(e) => setOperator(e.target.value)} maxLength={100} />
            <p className={styles.hint}>Untuk akun bersama. Otomatis tercatat pada absensi.</p>
          </div>
          <div>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? <Loader2 size={16} className="animate-pulse" /> : <Save size={16} />} Simpan
            </button>
          </div>
        </form>

        <form className={styles.card} onSubmit={handleSandi} aria-labelledby="sandi-judul">
          <h2 id="sandi-judul" className={styles.cardTitle}>Ganti Kata Sandi</h2>
          {sandiError && <p className="form-error" role="alert">{sandiError}</p>}
          {recovery ? (
            <p className={styles.hint}>Anda masuk lewat tautan pemulihan. Tentukan kata sandi baru.</p>
          ) : (
            <div className="form-group">
              <label className="form-label form-label--required" htmlFor="sandiLama">Kata sandi lama</label>
              <input id="sandiLama" type="password" className="form-input" value={sandiLama}
                onChange={(e) => setSandiLama(e.target.value)} autoComplete="current-password" />
            </div>
          )}
          <div className="form-group">
            <label className="form-label form-label--required" htmlFor="sandiBaru">Kata sandi baru</label>
            <input id="sandiBaru" type="password" className="form-input" value={sandiBaru}
              onChange={(e) => setSandiBaru(e.target.value)} autoComplete="new-password" minLength={8} maxLength={72} />
            <p className={styles.hint}>8 sampai 72 karakter.</p>
          </div>
          <div className="form-group">
            <label className="form-label form-label--required" htmlFor="sandiUlang">Ulangi kata sandi baru</label>
            <input id="sandiUlang" type="password" className="form-input" value={sandiUlang}
              onChange={(e) => setSandiUlang(e.target.value)} autoComplete="new-password" />
          </div>
          {!recovery && (
            <label className={styles.check}>
              <input type="checkbox" checked={keluarkan} onChange={(e) => setKeluarkan(e.target.checked)} />
              Keluarkan dari perangkat lain
            </label>
          )}
          <div>
            <button type="submit" className="btn btn--primary" disabled={sandiSaving}>
              {sandiSaving ? <Loader2 size={16} className="animate-pulse" /> : <KeyRound size={16} />} Ganti Kata Sandi
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

export default function ProfilPage() {
  return (
    <Suspense fallback={<div className="spinner" />}>
      <ProfilContent />
    </Suspense>
  );
}
