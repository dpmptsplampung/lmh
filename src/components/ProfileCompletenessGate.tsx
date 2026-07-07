'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { AlertCircle, Loader2, Sparkles } from 'lucide-react';
import styles from './profile-gate.module.css';

interface ProfileCompletenessGateProps {
  children: React.ReactNode;
}

export default function ProfileCompletenessGate({ children }: ProfileCompletenessGateProps) {
  const [loading, setLoading] = useState(true);
  const [complete, setComplete] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  // Form states
  const [formNama, setFormNama] = useState('');
  const [formAsal, setFormAsal] = useState('');
  const [formKategori, setFormKategori] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function checkProfile() {
      try {
        const supabase = createClient();
        
        // 1. Dapatkan user session
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          // Jika tidak ada user (anonim/belum login), biarkan children lewat (proxy.ts akan handle proteksi login jika butuh)
          setComplete(true);
          setLoading(false);
          return;
        }

        setUserId(user.id);

        // 2. Tarik data profil pengunjung
        const { data: profile, error: profileErr } = await supabase
          .from('pengunjung')
          .select('nama, asal_instansi, kategori')
          .eq('auth_user_id', user.id)
          .maybeSingle();

        if (profileErr) throw profileErr;

        if (profile) {
          setFormNama(profile.nama || '');
          setFormAsal(profile.asal_instansi || '');
          setFormKategori(profile.kategori || '');

          // Periksa kelengkapan
          if (
            profile.nama?.trim() && 
            profile.asal_instansi?.trim() && 
            profile.kategori?.trim()
          ) {
            setComplete(true);
          } else {
            setComplete(false);
          }
        } else {
          // Jika baris profil belum terbuat (sangat jarang karena auth callback route langsung inserts)
          setComplete(false);
        }
      } catch (err) {
        console.error('Error checking profile completeness:', err);
        // Fallback jika database belum migrasi, loloskan untuk mencegah fatal screen
        setComplete(true);
      } finally {
        setLoading(false);
      }
    }

    checkProfile();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;

    if (!formNama.trim()) {
      setError('Nama Lengkap wajib diisi');
      return;
    }
    if (!formAsal.trim()) {
      setError('Asal / Instansi wajib diisi');
      return;
    }
    if (!formKategori) {
      setError('Kategori Pengunjung wajib dipilih');
      return;
    }

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
          asal_instansi: formAsal.trim(),
          kategori: formKategori,
        }, { onConflict: 'auth_user_id' });

      if (updateErr) throw updateErr;

      setComplete(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan data profil.';
      setError(msg);
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
            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="nama">Nama Lengkap</label>
              <input
                id="nama"
                type="text"
                className={styles.input}
                placeholder="Masukkan nama lengkap Anda..."
                value={formNama}
                onChange={(e) => setFormNama(e.target.value)}
                required
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="asal">Asal / Instansi</label>
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

            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="kategori">Kategori Pengunjung</label>
              <select
                id="kategori"
                className={styles.select}
                value={formKategori}
                onChange={(e) => setFormKategori(e.target.value)}
                required
              >
                <option value="">-- Pilih Kategori --</option>
                <option value="umum">Masyarakat Umum</option>
                <option value="umkm">Pelaku Usaha / UMKM</option>
                <option value="investor">Investor / Pelaku Bisnis</option>
                <option value="instansi">Instansi Pemerintah / Swasta</option>
                <option value="akademisi">Akademisi / Mahasiswa</option>
              </select>
            </div>

            <button type="submit" className={styles.submitBtn} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="animate-spin" size={16} />
                  Menyimpan...
                </>
              ) : (
                'Simpan & Lanjutkan'
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
