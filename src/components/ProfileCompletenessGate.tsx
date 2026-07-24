'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { KATEGORI_PENGUNJUNG } from '@/lib/constants';
import { AlertCircle, CheckCircle2, HelpCircle, Loader2, Sparkles } from 'lucide-react';
import styles from './profile-gate.module.css';

interface ProfileCompletenessGateProps {
  children: React.ReactNode;
}

export function isPhoneValid(phone: string): boolean {
  const cleaned = phone.replace(/[\s-]/g, '');
  // Must start with 08, 628, or +628, followed by 7 to 12 digits (min 10 digits total)
  return /^(?:\+?62|62|0)8[1-9]\d{7,12}$/.test(cleaned);
}

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

  // Touched & modal states
  const [namaTouched, setNamaTouched] = useState(false);
  const [noHpTouched, setNoHpTouched] = useState(false);
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
          .select('nama, asal_instansi, kategori, no_hp')
          .eq('auth_user_id', user.id)
          .maybeSingle();

        if (profileErr) throw profileErr;

        if (profile) {
          setFormNama(profile.nama || '');
          setFormNoHp(profile.no_hp || '');
          setFormAsal(profile.asal_instansi || '');
          setFormKategori(profile.kategori || '');

          // Periksa kelengkapan termasuk nomor HP valid
          if (
            profile.nama?.trim() && 
            profile.asal_instansi?.trim() && 
            profile.kategori?.trim() &&
            profile.no_hp?.trim() &&
            isPhoneValid(profile.no_hp)
          ) {
            setComplete(true);
          } else {
            setComplete(false);
          }
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

  const isNamaValid = formNama.trim().length >= 3;
  const isHpValid = isPhoneValid(formNoHp);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setNamaTouched(true);
    setNoHpTouched(true);

    if (!isNamaValid) {
      setError('Peringatan: Nama Lengkap wajib diisi dengan benar (minimal 3 karakter).');
      return;
    }
    if (!formNoHp.trim()) {
      setError('Nomor HP / WhatsApp wajib diisi.');
      return;
    }
    if (!isHpValid) {
      setError('Nomor HP tidak valid. Harus diawali 08 / 628 / +628 dan minimal 10 digit.');
      return;
    }
    if (!formAsal.trim()) {
      setError('Asal / Instansi wajib diisi.');
      return;
    }
    if (!formKategori) {
      setError('Kategori Pengunjung wajib dipilih.');
      return;
    }

    setError('');
    // Buka popup konfirmasi sebelum menyimpan
    setShowConfirmModal(true);
  };

  const handleConfirmSave = async () => {
    if (!userId) return;

    setSaving(true);
    setError('');

    try {
      const supabase = createClient();

      // Upsert/Update data kelengkapan profil pengunjung
      const { error: updateErr } = await supabase
        .from('pengunjung')
        .upsert({
          auth_user_id: userId,
          nama: formNama.trim(),
          no_hp: formNoHp.trim(),
          asal_instansi: formAsal.trim(),
          kategori: formKategori,
        }, { onConflict: 'auth_user_id' });

      if (updateErr) throw updateErr;

      setShowConfirmModal(false);
      setComplete(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan data profil.';
      setError(msg);
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
            </p>
          </div>

          {error && (
            <div className={styles.error}>
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <form className={styles.form} onSubmit={handleSubmit}>
            {/* 1. Nama Lengkap with Warnings */}
            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="nama">Nama Lengkap *</label>
              <input
                id="nama"
                type="text"
                className={`${styles.input} ${namaTouched && !isNamaValid ? styles.inputError : ''}`}
                placeholder="Masukkan nama lengkap Anda sesuai KTP/Identitas..."
                value={formNama}
                onChange={(e) => {
                  setFormNama(e.target.value);
                  if (!namaTouched) setNamaTouched(true);
                }}
                onBlur={() => setNamaTouched(true)}
                required
              />
              {namaTouched && !isNamaValid && (
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

            {/* 3. Asal / Instansi */}
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

            {/* 4. Kategori Pengunjung */}
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

            <button type="submit" className={styles.submitBtn} disabled={saving}>
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
                  Apakah data yang Anda masukkan di bawah ini sudah benar dan sesuai?
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
