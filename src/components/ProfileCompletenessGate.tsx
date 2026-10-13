'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { KATEGORI_PENGUNJUNG } from '@/lib/constants';
import { MutasiError, mutasiInsert, pesanMutasi } from '@/lib/supabase/mutate';
import {
  PERNYATAAN_KEBENARAN_JENIS,
  PERNYATAAN_KEBENARAN_TEKS,
  PERNYATAAN_KEBENARAN_VERSI,
} from '@/lib/pernyataan-kebenaran';
import { isPhoneValid, profilLengkap, profilPengunjungSchema, validasiProfil } from '@/lib/profil-pengunjung';
import { AlertCircle, CheckCircle2, HelpCircle, Loader2, Lock, Sparkles } from 'lucide-react';
import styles from './profile-gate.module.css';

interface ProfileCompletenessGateProps {
  children: React.ReactNode;
}

// Dipertahankan agar impor lama (`import { isPhoneValid } from '.../ProfileCompletenessGate'`) tetap berlaku.
export { isPhoneValid };

const PESAN_CONSENT_GAGAL =
  'Pernyataan kebenaran data gagal dicatat, sehingga profil Anda belum disimpan. Silakan coba lagi.';
const PESAN_NAMA_TERKUNCI =
  'Nama Lengkap sudah terkunci dan tidak dapat diubah sendiri. Untuk mengubah nama, hubungi Front Office.';
const PESAN_CENTANG = 'Centang pernyataan kebenaran data terlebih dahulu.';

export default function ProfileCompletenessGate({ children }: ProfileCompletenessGateProps) {
  const [loading, setLoading] = useState(true);
  const [complete, setComplete] = useState(false);
  const [dbError, setDbError] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  // Form states
  const [formNama, setFormNama] = useState('');
  const [formNoHp, setFormNoHp] = useState('');
  const [formAsal, setFormAsal] = useState('');
  const [formKategori, setFormKategori] = useState('');
  const [formEmail, setFormEmail] = useState('');
  // K12: tombol Simpan baru aktif setelah pernyataan kebenaran dicentang.
  const [formSetuju, setFormSetuju] = useState(false);
  // K12 (keputusan CEO G.3 Opsi A): Nama Lengkap terkunci setelah profil lengkap tersimpan (ditegakkan trigger DB).
  const [namaTerkunci, setNamaTerkunci] = useState(false);

  // Touched & modal states
  const [namaTouched, setNamaTouched] = useState(false);
  const [noHpTouched, setNoHpTouched] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function checkProfile() {
      try {
        const supabase = createClient();

        // 1. Dapatkan user session
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          // Jika tidak ada user (anonim/belum login), biarkan children lewat
          setComplete(true);
          setLoading(false);
          return;
        }

        setUserId(user.id);

        // 2. Tarik data profil pengunjung
        const { data: profile, error: profileErr } = await supabase
          .from('pengunjung')
          .select('nama, email, asal_instansi, kategori, no_hp')
          .eq('auth_user_id', user.id)
          .maybeSingle();

        if (profileErr) throw profileErr;

        // Email awal: yang tersimpan, atau email akun login (Google) bila profil belum memilikinya.
        setFormEmail(profile?.email || user.email || '');

        if (profile) {
          setFormNama(profile.nama || '');
          setFormNoHp(profile.no_hp || '');
          setFormAsal(profile.asal_instansi || '');
          setFormKategori(profile.kategori || '');

          // Semua field wajib benar-benar terisi (nama, HP valid, asal, kategori, email): satu aturan di profil-pengunjung.ts
          const lengkap = profilLengkap(profile);
          setComplete(lengkap);
          // Profil lengkap = nama terkunci di database (trg_jaga_nama_pengunjung). Pada jalur gerbang ini hampir
          // selalu false (gerbang tampil hanya bila profil belum lengkap); tetap dipasang agar form tidak
          // menawarkan penyuntingan yang pasti ditolak database.
          setNamaTerkunci(lengkap);
        } else {
          setComplete(false);
        }
      } catch (err) {
        console.error('Error checking profile completeness:', err);
        setDbError(true);
      } finally {
        setLoading(false);
      }
    }

    checkProfile();
  }, []);

  const isNamaValid = profilPengunjungSchema.shape.nama.safeParse(formNama).success;
  const isHpValid = isPhoneValid(formNoHp);
  const isEmailValid = profilPengunjungSchema.shape.email.safeParse(formEmail).success;

  const masukanForm = () => ({
    nama: formNama,
    no_hp: formNoHp,
    asal_instansi: formAsal,
    kategori: formKategori,
    email: formEmail,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setNamaTouched(true);
    setNoHpTouched(true);
    setEmailTouched(true);

    // Tombol dinonaktifkan tanpa pernyataan, tetapi submit lewat Enter harus tetap ditolak.
    if (!formSetuju) {
      setError(PESAN_CENTANG);
      return;
    }

    const hasil = validasiProfil(masukanForm());
    if (!hasil.ok) {
      setError(hasil.pesan);
      return;
    }

    setError('');
    // Buka popup konfirmasi sebelum menyimpan
    setShowConfirmModal(true);
  };

  const handleConfirmSave = async () => {
    if (!userId) return;

    const hasil = validasiProfil(masukanForm());
    if (!formSetuju || !hasil.ok) {
      setShowConfirmModal(false);
      setError(!formSetuju ? PESAN_CENTANG : hasil.ok ? '' : hasil.pesan);
      return;
    }

    setSaving(true);
    setError('');

    const supabase = createClient();

    // 1. Catat pernyataan kebenaran DULU. Hasilnya wajib diperiksa: gagal = profil TIDAK disimpan (K12; menutup
    //    temuan "consent PDP tidak konsisten"). subjek_ref = auth.uid() (dibolehkan policy consent_log_insert_own).
    try {
      await mutasiInsert(
        supabase.from('consent_log').insert({
          subjek_ref: userId,
          tujuan: PERNYATAAN_KEBENARAN_JENIS,
          disetujui: true,
          versi_kebijakan: PERNYATAAN_KEBENARAN_VERSI,
        }),
      );
    } catch (err) {
      console.error('Gagal mencatat pernyataan kebenaran', err);
      setError(err instanceof MutasiError && err.kode === 'jaringan' ? pesanMutasi(err) : PESAN_CONSENT_GAGAL);
      setShowConfirmModal(false);
      setSaving(false);
      return;
    }

    // 2. Simpan profil (upsert); hasil diperiksa lewat helper mutasi.
    try {
      await mutasiInsert(
        supabase.from('pengunjung').upsert({
          auth_user_id: userId,
          nama: hasil.data.nama,
          no_hp: hasil.data.no_hp,
          asal_instansi: hasil.data.asal_instansi,
          kategori: hasil.data.kategori,
          email: hasil.data.email,
        }, { onConflict: 'auth_user_id' }),
      );

      setShowConfirmModal(false);
      setComplete(true);
    } catch (err) {
      console.error('Gagal menyimpan profil pengunjung', err);
      const asal = err instanceof MutasiError ? err.asal : undefined;
      const pesanDb = typeof asal === 'object' && asal !== null ? String((asal as { message?: unknown }).message ?? '') : '';
      setError(pesanDb.includes('NAMA_TERKUNCI') ? PESAN_NAMA_TERKUNCI : pesanMutasi(err, 'Gagal menyimpan data profil.'));
      setShowConfirmModal(false);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.overlay}>
        <div className={styles.loaderOverlay}>
          <Loader2 className="animate-spin" size={32} style={{ color: 'var(--color-primary-500)' }} />
          <span>Memeriksa kelengkapan profil...</span>
        </div>
      </div>
    );
  }

  if (dbError) {
    return (
      <div className={styles.overlay}>
        <div className={styles.loaderOverlay}>
          <p>Gagal memverifikasi profil. Coba refresh halaman.</p>
          <button className="btn btn--primary" onClick={() => window.location.reload()}>
            Coba Lagi
          </button>
        </div>
      </div>
    );
  }

  if (!complete) {
    return (
      <div className={styles.overlay}>
        <div className={styles.card}>
          <div className={styles.header}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
              <div style={{ padding: '12px', borderRadius: '16px', background: 'var(--color-primary-50)', color: 'var(--color-primary-600)' }}>
                <Sparkles size={24} />
              </div>
            </div>
            <h2 className={styles.title}>Lengkapi Profil Anda</h2>
            <p className={styles.subtitle}>
              Sebelum mengakses layanan dan Dashboard Lampung Maju Hub, mohon lengkapi data buku tamu Anda terlebih dahulu.
              Seluruh isian wajib diisi dengan benar.
            </p>
          </div>

          {error && (
            <div className={styles.error} role="alert">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            {/* 1. Nama Lengkap with Warnings */}
            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="nama">Nama Lengkap *</label>
              <input
                id="nama"
                type="text"
                className={`${styles.input} ${namaTerkunci ? styles.inputLocked : ''} ${namaTouched && !isNamaValid ? styles.inputError : ''}`}
                placeholder="Masukkan nama lengkap Anda sesuai KTP/Identitas..."
                value={formNama}
                onChange={(e) => {
                  setFormNama(e.target.value);
                  if (!namaTouched) setNamaTouched(true);
                }}
                onBlur={() => setNamaTouched(true)}
                readOnly={namaTerkunci}
                aria-readonly={namaTerkunci}
                aria-describedby="nama-catatan"
                required
              />
              {namaTerkunci ? (
                <div id="nama-catatan" className={styles.lockNote}>
                  <Lock size={12} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 4 }} />
                  Nama Lengkap terkunci. Untuk mengubah nama, hubungi Front Office.
                </div>
              ) : (
                <div id="nama-catatan" className={styles.lockNote}>
                  Isi sesuai identitas Anda. Setelah profil tersimpan, Nama Lengkap terkunci dan tidak dapat diubah
                  sendiri; untuk mengubahnya hubungi Front Office.
                </div>
              )}
              {namaTouched && !isNamaValid && !namaTerkunci && (
                <div className={styles.fieldWarning}>
                  <AlertCircle size={14} />
                  <span>Peringatan: Mohon isi nama lengkap Anda (minimal 3 karakter).</span>
                </div>
              )}
            </div>

            {/* 2. Nomor HP with Auto Verification */}
            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="no_hp">Nomor HP / WhatsApp *</label>
              <input
                id="no_hp"
                type="tel"
                className={`${styles.input} ${
                  noHpTouched && formNoHp
                    ? isHpValid
                      ? styles.inputSuccess
                      : styles.inputError
                    : ''
                }`}
                placeholder="Contoh: 081234567890 atau +6281234567890"
                value={formNoHp}
                onChange={(e) => {
                  setFormNoHp(e.target.value);
                  if (!noHpTouched) setNoHpTouched(true);
                }}
                onBlur={() => setNoHpTouched(true)}
                required
              />
              {noHpTouched && formNoHp ? (
                isHpValid ? (
                  <div className={styles.fieldSuccess}>
                    <CheckCircle2 size={14} />
                    <span>✓ Format Nomor HP valid (terverifikasi otomatis)</span>
                  </div>
                ) : (
                  <div className={styles.fieldWarning}>
                    <AlertCircle size={14} />
                    <span>
                      {formNoHp.replace(/[\s-]/g, '').length < 10
                        ? `Minimal 10 digit nomor HP (saat ini: ${formNoHp.replace(/[\s-]/g, '').length} digit)`
                        : 'Nomor HP tidak valid. Harus diawali 08 / 628 / +628'}
                    </span>
                  </div>
                )
              ) : (
                <div className={styles.fieldHint}>
                  Wajib diisi minimal 10 digit angka diawali 08 / +62. Verifikasi otomatis saat Anda mengetik.
                </div>
              )}
            </div>

            {/* 3. Email */}
            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="email">Email *</label>
              <input
                id="email"
                type="email"
                className={`${styles.input} ${emailTouched && !isEmailValid ? styles.inputError : ''}`}
                placeholder="Contoh: nama@email.com"
                value={formEmail}
                onChange={(e) => {
                  setFormEmail(e.target.value);
                  if (!emailTouched) setEmailTouched(true);
                }}
                onBlur={() => setEmailTouched(true)}
                required
              />
              {emailTouched && !isEmailValid && (
                <div className={styles.fieldWarning}>
                  <AlertCircle size={14} />
                  <span>Email wajib diisi dengan format yang benar.</span>
                </div>
              )}
            </div>

            {/* 4. Asal / Instansi */}
            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="asal">Asal / Instansi *</label>
              <input
                id="asal"
                type="text"
                className={styles.input}
                placeholder="Contoh: Universitas Lampung, PT ABC, atau Umum"
                value={formAsal}
                onChange={(e) => setFormAsal(e.target.value)}
                required
              />
            </div>

            {/* 5. Kategori Pengunjung */}
            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="kategori">Kategori Pengunjung *</label>
              <select
                id="kategori"
                className={styles.select}
                value={formKategori}
                onChange={(e) => setFormKategori(e.target.value)}
                required
              >
                <option value="">-- Pilih Kategori --</option>
                {Object.entries(KATEGORI_PENGUNJUNG).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            {/* 6. Pernyataan kebenaran data (K12): Simpan baru aktif setelah dicentang */}
            <label className={styles.consentRow} htmlFor="pernyataan-kebenaran">
              <input
                id="pernyataan-kebenaran"
                type="checkbox"
                checked={formSetuju}
                onChange={(e) => setFormSetuju(e.target.checked)}
              />
              <span className={styles.consentText}>{PERNYATAAN_KEBENARAN_TEKS}</span>
            </label>

            <button type="submit" className={styles.submitBtn} disabled={saving || !formSetuju}>
              Simpan & Lanjutkan
            </button>
          </form>
        </div>

        {/* Modal Confirmation Dialog Popup */}
        {showConfirmModal && (
          <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">
            <div className={styles.modalCard}>
              <div className={styles.modalHeader}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '4px' }}>
                  <div style={{ padding: '10px', borderRadius: '50%', background: 'var(--color-primary-50, #eef2ff)', color: 'var(--color-primary-600, #4f46e5)' }}>
                    <HelpCircle size={24} />
                  </div>
                </div>
                <h3 id="confirm-modal-title" className={styles.modalTitle}>Konfirmasi Data Anda</h3>
                <p className={styles.modalSubtitle}>
                  Apakah data yang Anda masukkan di bawah ini sudah benar dan sesuai? Nama Lengkap tidak dapat diubah
                  sendiri setelah disimpan.
                </p>
              </div>

              <div className={styles.summaryContainer}>
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>Nama Lengkap</span>
                  <span className={styles.summaryValue}>{formNama}</span>
                </div>
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>Nomor HP / WhatsApp</span>
                  <span className={styles.summaryValue}>{formNoHp}</span>
                </div>
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>Email</span>
                  <span className={styles.summaryValue}>{formEmail}</span>
                </div>
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>Asal / Instansi</span>
                  <span className={styles.summaryValue}>{formAsal}</span>
                </div>
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>Kategori Pengunjung</span>
                  <span className={styles.summaryValue}>
                    {KATEGORI_PENGUNJUNG[formKategori as keyof typeof KATEGORI_PENGUNJUNG] || formKategori}
                  </span>
                </div>
              </div>

              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => setShowConfirmModal(false)}
                  disabled={saving}
                >
                  Periksa Kembali
                </button>
                <button
                  type="button"
                  className={styles.confirmBtn}
                  onClick={handleConfirmSave}
                  disabled={saving}
                >
                  {saving ? (
                    <>
                      <Loader2 className="animate-spin" size={16} />
                      Menyimpan...
                    </>
                  ) : (
                    'Ya, Sudah Benar'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return <>{children}</>;
}
