'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CalendarPlus,
  MapPin,
  User,
  CheckCircle2,
  Loader2,
  Send,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import QRCodeDisplay from '@/components/QRCode';
import styles from './reservasi.module.css';

interface FormData {
  tujuan: 'loket' | 'bertemu_seseorang' | '';
  layanan_id: string;
  nama_yang_ditemui: string;
  tanggal_rencana: string;
  jam_rencana: string;
  keperluan: string;
}

export default function ReservasiPage() {
  const [form, setForm] = useState<FormData>({
    tujuan: '',
    layanan_id: '',
    nama_yang_ditemui: '',
    tanggal_rencana: '',
    jam_rencana: '',
    keperluan: '',
  });
  const [layananOptions, setLayananOptions] = useState<{ id: string; nama: string }[]>([]);
  const [pengunjungId, setPengunjungId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingInit, setLoadingInit] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<{ qr_token: string } | null>(null);

  // Set min date ke besok
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split('T')[0];

  useEffect(() => {
    const supabase = createClient();

    async function loadInitData() {
      // Get pengunjung id
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: pengunjung } = await supabase
          .from('pengunjung')
          .select('id')
          .eq('auth_user_id', user.id)
          .single();

        if (pengunjung) setPengunjungId(pengunjung.id);
      }

      // Get layanan
      try {
        const { data, error: fetchError } = await supabase
          .from('layanan')
          .select('id, nama')
          .neq('tipe', 'modul_publik')
          .order('nama');

        if (fetchError) throw fetchError;
        setLayananOptions(data || []);
      } catch {
        setLayananOptions([]);
      }

      setLoadingInit(false);
    }

    loadInitData();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validasi
    if (!form.tujuan) {
      setError('Pilih tujuan kunjungan');
      return;
    }
    if (form.tujuan === 'loket' && !form.layanan_id) {
      setError('Pilih layanan tujuan');
      return;
    }
    if (form.tujuan === 'bertemu_seseorang' && !form.nama_yang_ditemui.trim()) {
      setError('Masukkan nama orang yang ingin ditemui');
      return;
    }
    if (!form.tanggal_rencana) {
      setError('Pilih tanggal kedatangan');
      return;
    }
    if (!pengunjungId) {
      setError('Sesi login tidak ditemukan. Silakan login ulang.');
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();

      const insertData: Record<string, unknown> = {
        asal: 'reservasi',
        pengunjung_id: pengunjungId,
        tujuan: form.tujuan,
        tanggal_rencana: form.tanggal_rencana,
        keperluan: form.keperluan.trim() || null,
        status: 'terjadwal',
      };

      if (form.tujuan === 'loket') {
        insertData.layanan_id = form.layanan_id;
      } else {
        insertData.nama_yang_ditemui = form.nama_yang_ditemui.trim();
      }

      if (form.jam_rencana) {
        insertData.jam_rencana = form.jam_rencana;
      }

      const { data, error: insertError } = await supabase
        .from('visit')
        .insert(insertData)
        .select('qr_token')
        .single();

      if (insertError) throw insertError;
      setSuccess({ qr_token: data.qr_token });
    } catch (err) {
      setError('Gagal membuat reservasi. Silakan coba lagi.');
      console.error('Reservasi error:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loadingInit) {
    return (
      <div className={styles.reservasiPage}>
        <div className={styles.container}>
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-20)' }}>
            <div className="spinner" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.reservasiPage}>
      <div className={styles.container}>
        <Link href="/me" className={styles.backLink}>
          <ArrowLeft size={16} />
          Kembali ke Dashboard
        </Link>

        <div className={styles.formCard}>
          {success ? (
            /* Success State */
            <div className={styles.successCard}>
              <div className={styles.successIcon}>
                <CheckCircle2 size={32} />
              </div>
              <h2 className={styles.successTitle}>Reservasi Berhasil! 🎉</h2>
              <p className={styles.successDescription}>
                Simpan QR code ini dan tunjukkan ke petugas saat Anda tiba di kantor DPMPTSP.
              </p>

              <div className={styles.qrWrapper}>
                <QRCodeDisplay value={success.qr_token} size={180} />
                <p className={styles.qrHint}>
                  Tunjukkan QR code ini ke petugas saat scan di kantor
                </p>
              </div>

              <div className={styles.successActions}>
                <Link href="/me" className="btn btn--primary btn--lg">
                  Kembali ke Dashboard
                </Link>
                <button
                  className="btn btn--secondary btn--lg"
                  onClick={() => {
                    setSuccess(null);
                    setForm({
                      tujuan: '',
                      layanan_id: '',
                      nama_yang_ditemui: '',
                      tanggal_rencana: '',
                      jam_rencana: '',
                      keperluan: '',
                    });
                  }}
                >
                  <CalendarPlus size={18} />
                  Buat Reservasi Lain
                </button>
              </div>
            </div>
          ) : (
            /* Form */
            <>
              <div className={styles.formHeader}>
                <div className={styles.formIcon}>
                  <CalendarPlus size={28} />
                </div>
                <h1 className={styles.formTitle}>Rencanakan Kedatangan</h1>
                <p className={styles.formSubtitle}>
                  Booking kunjungan Anda ke kantor DPMPTSP. Setelah selesai, Anda akan mendapatkan QR code
                  yang bisa di-scan petugas saat tiba.
                </p>
              </div>

              <form className={styles.formBody} onSubmit={handleSubmit}>
                {/* Tujuan */}
                <div className="form-group">
                  <label className="form-label form-label--required">Tujuan Kunjungan</label>
                  <div className={styles.tujuanGroup}>
                    <div
                      className={`${styles.tujuanOption} ${form.tujuan === 'loket' ? styles.tujuanOptionActive : ''}`}
                      onClick={() => setForm({ ...form, tujuan: 'loket', nama_yang_ditemui: '' })}
                    >
                      <div className={`${styles.tujuanRadio} ${form.tujuan === 'loket' ? styles.tujuanRadioActive : ''}`} />
                      <div className={`${styles.tujuanIcon} ${styles.tujuanIconLoket}`}>
                        <MapPin size={20} />
                      </div>
                      <div>
                        <div className={styles.tujuanLabel}>Menuju Loket Layanan</div>
                        <div className={styles.tujuanHint}>Helpdesk OSS, Sertifikasi Halal, CS BPJS</div>
                      </div>
                    </div>

                    <div
                      className={`${styles.tujuanOption} ${form.tujuan === 'bertemu_seseorang' ? styles.tujuanOptionActive : ''}`}
                      onClick={() => setForm({ ...form, tujuan: 'bertemu_seseorang', layanan_id: '' })}
                    >
                      <div className={`${styles.tujuanRadio} ${form.tujuan === 'bertemu_seseorang' ? styles.tujuanRadioActive : ''}`} />
                      <div className={`${styles.tujuanIcon} ${styles.tujuanIconBertemu}`}>
                        <User size={20} />
                      </div>
                      <div>
                        <div className={styles.tujuanLabel}>Bertemu Seseorang</div>
                        <div className={styles.tujuanHint}>Ketik nama orang yang ingin ditemui</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Layanan (jika loket) */}
                {form.tujuan === 'loket' && (
                  <div className="form-group">
                    <label className="form-label form-label--required" htmlFor="layanan">
                      Layanan Tujuan
                    </label>
                    {layananOptions.length === 0 ? (
                      <p className="form-hint" style={{ color: 'var(--color-danger-600)' }}>
                        Gagal memuat layanan
                      </p>
                    ) : (
                      <select
                        id="layanan"
                        className="form-select"
                        value={form.layanan_id}
                        onChange={(e) => setForm({ ...form, layanan_id: e.target.value })}
                      >
                        <option value="">— Pilih layanan —</option>
                        {layananOptions.map((l) => (
                          <option key={l.id} value={l.id}>{l.nama}</option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                {/* Nama yang ditemui (jika bertemu) */}
                {form.tujuan === 'bertemu_seseorang' && (
                  <div className="form-group">
                    <label className="form-label form-label--required" htmlFor="namaDitemui">
                      Nama yang Ingin Ditemui
                    </label>
                    <input
                      id="namaDitemui"
                      type="text"
                      className="form-input"
                      placeholder="Masukkan nama lengkap"
                      value={form.nama_yang_ditemui}
                      onChange={(e) => setForm({ ...form, nama_yang_ditemui: e.target.value })}
                    />
                  </div>
                )}

                {/* Tanggal */}
                <div className="form-group">
                  <label className="form-label form-label--required" htmlFor="tanggal">
                    Tanggal Kedatangan
                  </label>
                  <input
                    id="tanggal"
                    type="date"
                    className="form-input"
                    min={minDate}
                    value={form.tanggal_rencana}
                    onChange={(e) => setForm({ ...form, tanggal_rencana: e.target.value })}
                  />
                </div>

                {/* Jam (opsional) */}
                <div className="form-group">
                  <label className="form-label" htmlFor="jam">
                    Perkiraan Jam Kedatangan
                  </label>
                  <input
                    id="jam"
                    type="time"
                    className="form-input"
                    value={form.jam_rencana}
                    onChange={(e) => setForm({ ...form, jam_rencana: e.target.value })}
                  />
                  <span className="form-hint">Opsional — membantu petugas mempersiapkan layanan</span>
                </div>

                {/* Keperluan */}
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
                </div>

                {error && (
                  <div className="form-error" role="alert">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  className="btn btn--primary btn--lg"
                  disabled={loading || (form.tujuan === 'loket' && layananOptions.length === 0)}
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
                      Buat Reservasi
                    </>
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
