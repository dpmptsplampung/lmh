'use client';

import { useState, useEffect } from 'react';
import { HandHelping, Loader2, CheckCircle2, Send } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';
import styles from './checkin-asist.module.css';

interface LayananOption {
  id: string;
  nama: string;
}

export default function CheckinAsistPage() {
  const { toast } = useToast();
  const [form, setForm] = useState({
    nama: '',
    layanan_id: '',
    keperluan: '',
    asal_instansi: '',
  });
  const [layananOptions, setLayananOptions] = useState<LayananOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingLayanan, setLoadingLayanan] = useState(true);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function loadLayanan() {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from('layanan')
          .select('id, nama')
          .neq('tipe', 'modul_publik')
          .order('nama');

        if (error) throw error;
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

    if (!form.nama.trim()) {
      toast('Nama wajib diisi', 'error');
      return;
    }
    if (!form.layanan_id) {
      toast('Pilih layanan tujuan', 'error');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/admin/checkin-asist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nama: form.nama.trim(),
          layanan_id: form.layanan_id,
          keperluan: form.keperluan.trim() || undefined,
          asal_instansi: form.asal_instansi.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Gagal menyimpan check-in');
      }

      setSuccess(true);
      toast('Check-in bantuan berhasil', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan check-in';
      toast(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setForm({ nama: '', layanan_id: '', keperluan: '', asal_instansi: '' });
    setSuccess(false);
  };

  if (success) {
    return (
      <div className={styles.page}>
        <PageHeader
          title="Checkin Bantuan"
          description="Mode bantuan petugas — checkin manual untuk pengunjung yang tidak dapat menggunakan kiosk."
        />
        <div className={styles.successState}>
          <div className={styles.successIcon}>
            <CheckCircle2 size={36} />
          </div>
          <h2 className={styles.successTitle}>Check-in Berhasil!</h2>
          <p className={styles.successDescription}>
            Kunjungan pengunjung telah tercatat. Silakan lanjutkan jika ada pengunjung lain.
          </p>
          <button
            className="btn btn--primary btn--lg"
            onClick={handleReset}
            style={{ width: '100%', maxWidth: 400 }}
          >
            Check-in Baru
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Checkin Bantuan"
        description="Mode bantuan petugas — checkin manual untuk pengunjung yang tidak dapat menggunakan kiosk."
      />

      <div className={styles.formCard}>
        <div className={styles.formHeader}>
          <div className={styles.formIcon}>
            <HandHelping size={24} />
          </div>
          <h2 className={styles.formTitle}>Formulir Check-in Manual</h2>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label form-label--required" htmlFor="asist-nama">
              Nama Pengunjung
            </label>
            <input
              id="asist-nama"
              type="text"
              className="form-input"
              placeholder="Masukkan nama pengunjung"
              value={form.nama}
              onChange={(e) => setForm({ ...form, nama: e.target.value })}
              autoComplete="off"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label form-label--required" htmlFor="asist-layanan">
              Layanan Tujuan
            </label>
            <select
              id="asist-layanan"
              className="form-select"
              value={form.layanan_id}
              onChange={(e) => setForm({ ...form, layanan_id: e.target.value })}
              disabled={loadingLayanan}
              required
            >
              <option value="">— Pilih layanan —</option>
              {layananOptions.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nama}
                </option>
              ))}
            </select>
            {!loadingLayanan && layananOptions.length === 0 && (
              <span className="form-hint" style={{ color: 'var(--color-danger-600)' }}>
                Gagal memuat layanan. Coba refresh halaman.
              </span>
            )}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="asist-asal">
              Asal Instansi
            </label>
            <input
              id="asist-asal"
              type="text"
              className="form-input"
              placeholder="Instansi/organisasi pengunjung (opsional)"
              value={form.asal_instansi}
              onChange={(e) => setForm({ ...form, asal_instansi: e.target.value })}
              autoComplete="off"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="asist-keperluan">
              Keperluan
            </label>
            <textarea
              id="asist-keperluan"
              className="form-textarea"
              placeholder="Jelaskan keperluan pengunjung (opsional)"
              value={form.keperluan}
              onChange={(e) => setForm({ ...form, keperluan: e.target.value })}
              rows={3}
            />
          </div>

          <button
            type="submit"
            className="btn btn--primary btn--lg"
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
                Simpan Check-in
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
