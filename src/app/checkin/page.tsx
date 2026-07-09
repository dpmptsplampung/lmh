'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ClipboardCheck,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Send,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { APP_NAME } from '@/lib/constants';
import styles from './checkin.module.css';

interface FormData {
  nama: string;
  keperluan: string;
  layanan_id: string;
}

export default function CheckinPage() {
  const [form, setForm] = useState<FormData>({
    nama: '',
    keperluan: '',
    layanan_id: '',
  });
  const [layananOptions, setLayananOptions] = useState<{ id: string; nama: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [loadingLayanan, setLoadingLayanan] = useState(true);

  // Load layanan on mount
  useEffect(() => {
    async function loadLayanan() {
      try {
        const supabase = createClient();
        const { data, error: fetchError } = await supabase
          .from('layanan')
          .select('id, nama')
          .order('nama');

        if (fetchError) throw fetchError;
        setLayananOptions(data || []);
      } catch {
        setLayananOptions([]);
      } finally {
        setLoadingLayanan(false);
      }
    }
    loadLayanan();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!form.nama.trim()) {
      setError('Nama wajib diisi');
      return;
    }
    if (!form.layanan_id) {
      setError('Pilih layanan tujuan');
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { error: insertError } = await supabase
        .from('kunjungan')
        .insert({
          nama: form.nama.trim(),
          keperluan: form.keperluan.trim() || null,
          layanan_id: form.layanan_id,
        });

      if (insertError) throw insertError;
      setSuccess(true);
    } catch (err) {
      setError('Gagal menyimpan data. Silakan coba lagi.');
      console.error('Check-in error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setForm({ nama: '', keperluan: '', layanan_id: '' });
    setSuccess(false);
    setError('');
  };

  return (
    <div className={styles.checkinPage}>
      <div className={styles.checkinGlow} />
      <div className={styles.checkinCard}>
        {/* Header */}
        <div className={styles.checkinHeader}>
          <div className={styles.checkinIcon}>
            <ClipboardCheck size={28} />
          </div>
          <h1 className={styles.checkinTitle}>Check-in Kunjungan</h1>
          <p className={styles.checkinSubtitle}>
            Selamat datang di {APP_NAME}
          </p>
        </div>

        {/* Body */}
        <div className={styles.checkinBody}>
          {success ? (
            <div className={styles.successState}>
              <div className={styles.successIcon}>
                <CheckCircle2 size={36} />
              </div>
              <h2 className={styles.successTitle}>Check-in Berhasil!</h2>
              <p className={styles.successDescription}>
                Terima kasih telah mendaftar. Silakan menunggu,
                petugas akan segera melayani Anda.
              </p>
              <button
                className="btn btn--primary btn--lg"
                onClick={handleReset}
                style={{ width: '100%' }}
              >
                Check-in Baru
              </button>
            </div>
          ) : (
            <form className={styles.checkinForm} onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label form-label--required" htmlFor="nama">
                  Nama Lengkap
                </label>
                <input
                  id="nama"
                  type="text"
                  className="form-input"
                  placeholder="Masukkan nama lengkap Anda"
                  value={form.nama}
                  onChange={(e) => setForm({ ...form, nama: e.target.value })}
                  autoComplete="name"
                />
              </div>

              <div className="form-group">
                <label className="form-label form-label--required" htmlFor="layanan">
                  Layanan Tujuan
                </label>
                {!loadingLayanan && layananOptions.length === 0 ? (
                  <p className="form-hint" style={{ color: 'var(--color-danger-600)' }}>
                    Gagal memuat layanan. Coba refresh halaman.
                  </p>
                ) : (
                  <select
                    id="layanan"
                    className="form-select"
                    value={form.layanan_id}
                    onChange={(e) => setForm({ ...form, layanan_id: e.target.value })}
                    disabled={loadingLayanan}
                  >
                    <option value="">— Pilih layanan —</option>
                    {layananOptions.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.nama}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="keperluan">
                  Keperluan
                </label>
                <textarea
                  id="keperluan"
                  className="form-textarea"
                  placeholder="Jelaskan secara singkat keperluan Anda (opsional)"
                  value={form.keperluan}
                  onChange={(e) => setForm({ ...form, keperluan: e.target.value })}
                  rows={3}
                />
                <span className="form-hint">
                  Opsional — membantu petugas mempersiapkan layanan
                </span>
              </div>

              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}

              <button
                type="submit"
                className={`btn btn--primary btn--lg ${styles.checkinSubmit}`}
                disabled={loading || layananOptions.length === 0}
                style={{ width: '100%' }}
              >
                {loading ? (
                  <>
                    <Loader2 size={20} className="animate-pulse" />
                    Memproses...
                  </>
                ) : (
                  <>
                    <Send size={20} />
                    Kirim Check-in
                  </>
                )}
              </button>
            </form>
          )}

          <Link href="/" className={styles.backLink}>
            <ArrowLeft size={16} />
            Kembali ke halaman utama
          </Link>
        </div>
      </div>
    </div>
  );
}
