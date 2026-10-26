'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { todayWIB, addDaysWIB } from '@/lib/time';
import {
  ArrowLeft,
  CalendarPlus,
  MapPin,
  User,
  CheckCircle2,
  Loader2,
  Send,
  Clock,
  Users,
  XCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { mutasiInsert } from '@/lib/supabase/mutate';
import { GalatRpc } from '@/lib/rpc-galat';
import {
  KOLOM_RESERVASI,
  labelStatusReservasi,
  panggilReservasiBatalkan,
  panggilReservasiBuat,
  pesanGalatReservasiBatal,
  pesanGalatReservasiBuat,
  type ReservasiKunjungan,
} from '@/lib/reservasi';
import ErrorRetry from '@/components/ErrorRetry';
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

const CONSENT_VERSION = '1.0';
const CONSENT_TEXT = 'Saya setuju data saya diproses sesuai Kebijakan Privasi.';
const MAX_BOOKING_DAYS = 7; // QUE-05: horizon reservasi maksimal H+7 (tanpa slot jam)

export default function ReservasiPage() {
  const [form, setForm] = useState<FormData>({
    tujuan: '',
    layanan_id: '',
    nama_yang_ditemui: '',
    tanggal_rencana: '',
    jam_rencana: '',
    keperluan: '',
  });
  const [layananOptions, setLayananOptions] = useState<{ id: string; nama: string; status_tampilan?: string; punya_antrean?: boolean }[]>([]);
  const [pengunjungId, setPengunjungId] = useState<string | null>(null);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  // Reservasi Saya (kontrak §6.6): baris `kunjungan` milik pengunjung ini.
  const [daftar, setDaftar] = useState<ReservasiKunjungan[]>([]);
  const [daftarGagal, setDaftarGagal] = useState(false);
  const [konfirmasiBatal, setKonfirmasiBatal] = useState<string | null>(null);
  const [membatalkan, setMembatalkan] = useState<string | null>(null);
  const [infoBatal, setInfoBatal] = useState('');
  const [galatBatal, setGalatBatal] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingInit, setLoadingInit] = useState(true);
  const [error, setError] = useState('');
  // S1: pencatatan consent_log gagal -> reservasi tidak dibuat; ditampilkan lewat ErrorRetry (bukan teks biasa).
  const [consentGagal, setConsentGagal] = useState(false);
  const [success, setSuccess] = useState<{ qr_token: string; tanggal_rencana: string } | null>(null);
  const [consentGiven, setConsentGiven] = useState(false);
  const [estimasiLayanan, setEstimasiLayanan] = useState<{
    antre_count: number;
    estimasi_tunggu_total_menit: number;
  } | null>(null);

  // Set min date ke hari ini, max 30 hari ke depan (batas hari memakai Asia/Jakarta — RPT-07)
  const minDate = todayWIB();
  const maxDate = addDaysWIB(MAX_BOOKING_DAYS);

  // Daftar reservasi milik pengunjung (§6.6). Filter pengunjung_id eksplisit: staf yang membuka halaman ini
  // lolos RLS baca semua `kunjungan`, jadi jangan bergantung pada RLS saja.
  const muatDaftar = useCallback(async (idPengunjung: string) => {
    try {
      const { data, error: daftarError } = await createClient()
        .from('kunjungan')
        .select(KOLOM_RESERVASI)
        .eq('pengunjung_id', idPengunjung)
        .eq('asal', 'reservasi')
        .order('tanggal', { ascending: false })
        .limit(30);
      if (daftarError) throw daftarError;
      setDaftar((data ?? []) as unknown as ReservasiKunjungan[]);
      setDaftarGagal(false);
    } catch {
      setDaftarGagal(true);
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();

    async function loadInitData() {
      // Get pengunjung id
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setAuthUserId(user.id);
        const { data: pengunjung } = await supabase
          .from('pengunjung')
          .select('id, nama')
          .eq('auth_user_id', user.id)
          .single();

        if (pengunjung) {
          setPengunjungId(pengunjung.id);
          await muatDaftar(pengunjung.id);
        }
      }

      // Get layanan
      try {
        const { data, error: fetchError } = await supabase
          .from('v_layanan_publik')
          .select('id, nama, status_tampilan, punya_antrean')
          .neq('tipe', 'modul_publik')
          .order('nama');

        if (fetchError) throw fetchError;
        setLayananOptions((data || []).filter((l) => l.punya_antrean !== false));
      } catch {
        setLayananOptions([]);
      }

      setLoadingInit(false);
    }

    loadInitData();
  }, [muatDaftar]);

  // Fetch estimasi antrean untuk layanan yang dipilih (I2)
  useEffect(() => {
    if (!form.layanan_id) {
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from('v_antrian_loket')
      .select('antre_count, estimasi_tunggu_total_menit')
      .eq('layanan_id', form.layanan_id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setEstimasiLayanan(data as { antre_count: number; estimasi_tunggu_total_menit: number } | null);
      });
    return () => {
      cancelled = true;
      setEstimasiLayanan(null);
    };
  }, [form.layanan_id]);

  // `e` opsional: tombol "Coba lagi" (ErrorRetry) memanggil ulang tanpa event submit.
  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError('');
    setConsentGagal(false);

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
    if (form.tanggal_rencana > maxDate) {
      setError(`Tanggal kedatangan maksimal ${MAX_BOOKING_DAYS} hari ke depan.`);
      return;
    }
    // Tujuan "bertemu seseorang" tidak punya jadwal layanan: hanya hari kerja kantor dan bukan hari libur nasional
    // (mirror validasi reservasi_buat). Tujuan "loket" mengikuti jadwal layanan (termasuk Sabtu) lewat RPC di bawah.
    if (form.tujuan === 'bertemu_seseorang') {
      // 0 = Minggu, 6 = Sabtu (parse eksplisit agar tidak tergantung timezone)
      const dayOfWeek = new Date(`${form.tanggal_rencana}T00:00:00`).getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        setError('Reservasi hanya tersedia pada hari kerja (Senin–Jumat). Mau tanya dulu? Live chat tersedia.');
        return;
      }
      const { data: libur, error: liburError } = await createClient()
        .from('hari_libur')
        .select('tanggal')
        .eq('tanggal', form.tanggal_rencana)
        .maybeSingle();
      // Error baca diperlakukan "tidak diketahui" -> tidak menolak; validasi sesungguhnya di DB.
      if (!liburError && libur) {
        setError('Kantor libur pada tanggal tersebut.');
        return;
      }
    }
    // SCH-01/SCH-11: tolak di luar jadwal standby dengan menyebut jadwal terdekat (P3).
    if (form.tujuan === 'loket' && form.layanan_id) {
      const supabase = createClient();
      const { data: buka, error: bukaError } = await supabase.rpc('is_layanan_buka_jadwal', {
        p_layanan_id: form.layanan_id,
        p_tanggal: form.tanggal_rencana,
        p_jam: null,
      });
      // Error RPC (baca saja) diperlakukan "tidak diketahui" -> tidak menolak; validasi sesungguhnya di DB.
      if (!bukaError && buka === false) {
        const { data: jadwalBerikutnya, error: jadwalError } = await supabase.rpc('jadwal_berikutnya', {
          p_layanan_id: form.layanan_id,
          p_dari_tanggal: form.tanggal_rencana,
        });
        const layananNama = layananOptions.find((l) => l.id === form.layanan_id)?.nama ?? 'Layanan ini';
        const tglTeks = !jadwalError && jadwalBerikutnya
          ? new Date(`${jadwalBerikutnya}T00:00:00`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })
          : null;
        setError(
          tglTeks
            ? `${layananNama} di kantor DPMPTSP tidak beroperasi pada tanggal itu. Jadwal terdekat: ${tglTeks}. Mau reservasi untuk tanggal itu, atau tanya lewat live chat sekarang?`
            : `${layananNama} tidak beroperasi pada tanggal itu. Silakan tanya lewat live chat untuk jadwal pasti.`,
        );
        return;
      }
    }
    if (!consentGiven) {
      setError('Anda harus menyetujui pemrosesan data sesuai Kebijakan Privasi.');
      return;
    }
    if (!pengunjungId) {
      setError('Sesi login tidak ditemukan. Silakan login ulang.');
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();

      // Catat consent PDP sebelum memanggil rpc reservasi_buat. Hasilnya WAJIB diperiksa (supabase-js tidak
      // melempar, kegagalan kembali sebagai { error }): gagal -> reservasi TIDAK dilanjutkan
      // dan pengguna diminta mencoba lagi (audit S1, K11; pola K-2 di check-in).
      if (authUserId && consentGiven) {
        try {
          await mutasiInsert(
            supabase.from('consent_log').insert({
              subjek_ref: authUserId,
              tujuan: 'reservasi_data',
              disetujui: true,
              versi_kebijakan: CONSENT_VERSION,
            }),
          );
        } catch (consentErr) {
          console.error('Consent reservasi gagal dicatat:', consentErr);
          setConsentGagal(true);
          return; // `finally` di bawah mengembalikan loading = false
        }
      }

      // Reservasi = baris `kunjungan` (rpc reservasi_buat, kontrak §4.1); tidak lagi menulis `visit`.
      // Server memvalidasi ulang tanggal/jadwal/kuota dan menyalin data profil.
      const hasil = await panggilReservasiBuat(supabase, {
        tujuan: form.tujuan,
        layananId: form.layanan_id,
        namaYangDitemui: form.nama_yang_ditemui,
        tanggal: form.tanggal_rencana,
        jamRencana: form.jam_rencana,
        keperluan: form.keperluan,
      });
      setSuccess({ qr_token: hasil.qrToken, tanggal_rencana: hasil.tanggal });
      void muatDaftar(pengunjungId);
    } catch (err) {
      setError(pesanGalatReservasiBuat(err));
      // RESERVASI_GANDA bisa berarti percobaan sebelumnya sudah tersimpan (balasan hilang): segarkan daftar.
      if (err instanceof GalatRpc && err.kode === 'RESERVASI_GANDA') void muatDaftar(pengunjungId);
      console.error('Reservasi error:', err);
    } finally {
      setLoading(false);
    }
  };

  const batalkan = async (id: string) => {
    if (membatalkan) return;
    setMembatalkan(id);
    setGalatBatal('');
    setInfoBatal('');
    try {
      await panggilReservasiBatalkan(createClient(), id);
      setInfoBatal('Reservasi dibatalkan.');
      setKonfirmasiBatal(null);
    } catch (err) {
      setGalatBatal(pesanGalatReservasiBatal(err));
      console.error('Pembatalan reservasi gagal:', err);
    } finally {
      setMembatalkan(null);
      // Status bisa saja berubah di server (mis. sudah check-in): selalu segarkan.
      if (pengunjungId) void muatDaftar(pengunjungId);
    }
  };

  const namaLayananSaran = (id: string | null) =>
    (id && layananOptions.find((l) => l.id === id)?.nama) || 'Loket Layanan';

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
                  Tunjukkan QR code ini ke petugas Front Office untuk dipindai saat tiba di kantor
                </p>
                <p className={styles.qrHint}>
                  QR ini juga tersimpan di daftar Reservasi Saya di bawah.
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
                  yang dipindai petugas Front Office saat Anda tiba.
                </p>
              </div>

              <form className={styles.formBody} onSubmit={handleSubmit}>
                {/* Tujuan */}
                <div className="form-group">
                  <label className="form-label form-label--required">Tujuan Kunjungan</label>
                  <div className={styles.tujuanGroup} role="radiogroup" aria-label="Tujuan Kunjungan">
                    <label
                      className={`${styles.tujuanOption} ${form.tujuan === 'loket' ? styles.tujuanOptionActive : ''}`}
                    >
                      <input
                        type="radio"
                        name="tujuan"
                        value="loket"
                        checked={form.tujuan === 'loket'}
                        onChange={() => setForm({ ...form, tujuan: 'loket', nama_yang_ditemui: '' })}
                        className={styles.tujuanRadioInput}
                      />
                      <span
                        className={`${styles.tujuanRadio} ${form.tujuan === 'loket' ? styles.tujuanRadioActive : ''}`}
                        aria-hidden
                      />
                      <span className={`${styles.tujuanIcon} ${styles.tujuanIconLoket}`} aria-hidden>
                        <MapPin size={20} />
                      </span>
                      <span>
                        <span className={styles.tujuanLabel}>Menuju Loket Layanan</span>
                        <span className={styles.tujuanHint}>Helpdesk OSS, Sertifikasi Halal, CS BPJS</span>
                      </span>
                    </label>

                    <label
                      className={`${styles.tujuanOption} ${form.tujuan === 'bertemu_seseorang' ? styles.tujuanOptionActive : ''}`}
                    >
                      <input
                        type="radio"
                        name="tujuan"
                        value="bertemu_seseorang"
                        checked={form.tujuan === 'bertemu_seseorang'}
                        onChange={() => setForm({ ...form, tujuan: 'bertemu_seseorang', layanan_id: '' })}
                        className={styles.tujuanRadioInput}
                      />
                      <span
                        className={`${styles.tujuanRadio} ${form.tujuan === 'bertemu_seseorang' ? styles.tujuanRadioActive : ''}`}
                        aria-hidden
                      />
                      <span className={`${styles.tujuanIcon} ${styles.tujuanIconBertemu}`} aria-hidden>
                        <User size={20} />
                      </span>
                      <span>
                        <span className={styles.tujuanLabel}>Bertemu Seseorang</span>
                        <span className={styles.tujuanHint}>Ketik nama orang yang ingin ditemui</span>
                      </span>
                    </label>
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
                          <option key={l.id} value={l.id} disabled={l.status_tampilan === 'coming_soon'}>
                            {l.nama}{l.status_tampilan === 'coming_soon' ? ' (Segera hadir)' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                    {form.layanan_id && estimasiLayanan && (
                      <div className={styles.estimasiInline}>
                        <Clock size={16} />
                        <span>
                          Saat ini: ~{estimasiLayanan.estimasi_tunggu_total_menit} menit,&nbsp;
                          <Users size={14} style={{ verticalAlign: 'middle', display: 'inline' }} />
                          {' '}{estimasiLayanan.antre_count} antre
                        </span>
                      </div>
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
                    max={maxDate}
                    value={form.tanggal_rencana}
                    onChange={(e) => setForm({ ...form, tanggal_rencana: e.target.value })}
                  />
                  <span className="form-hint">
                    Reservasi hanya tersedia pada hari kerja (Senin–Jumat), maksimal {MAX_BOOKING_DAYS} hari ke depan.
                  </span>
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

                {consentGagal ? (
                  <ErrorRetry
                    judul="Reservasi belum dibuat"
                    pesan="Persetujuan belum tercatat, coba lagi"
                    onRetry={() => void handleSubmit()}
                  />
                ) : (
                  error && (
                    <div className="form-error" role="alert">
                      {error}
                    </div>
                  )
                )}

                {/* Consent PDP — wajib sebelum submit */}
                <div className="form-group" style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
                  <input
                    id="consent"
                    type="checkbox"
                    checked={consentGiven}
                    onChange={(e) => setConsentGiven(e.target.checked)}
                    style={{ marginTop: '4px', width: '18px', height: '18px', cursor: 'pointer', flexShrink: 0 }}
                    required
                  />
                  <label
                    htmlFor="consent"
                    style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', cursor: 'pointer', lineHeight: 1.5 }}
                  >
                    {CONSENT_TEXT}{' '}
                    <Link
                      href="/kebijakan-privasi"
                      style={{ color: 'var(--color-primary-600)', textDecoration: 'underline' }}
                    >
                      Baca kebijakan
                    </Link>
                  </label>
                </div>

                <button
                  type="submit"
                  className="btn btn--primary btn--lg"
                  disabled={loading || !consentGiven || (form.tujuan === 'loket' && layananOptions.length === 0)}
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

        {/* Reservasi Saya: baris kunjungan (kontrak §6.6), QR untuk yang masih terjadwal */}
        <section className={styles.daftarSection} aria-labelledby="reservasi-saya-judul">
          <h2 id="reservasi-saya-judul" className={styles.daftarTitle}>
            Reservasi Saya
          </h2>
          <div role="status" aria-live="polite">
            {infoBatal && <p className={styles.daftarInfo}>{infoBatal}</p>}
          </div>
          {galatBatal && (
            <div className="form-error" role="alert" style={{ marginBottom: 'var(--space-3)' }}>
              {galatBatal}
            </div>
          )}
          {daftarGagal ? (
            <ErrorRetry
              judul="Daftar reservasi belum termuat"
              pesan="Daftar reservasi Anda tidak dapat dimuat saat ini."
              onRetry={() => {
                if (pengunjungId) void muatDaftar(pengunjungId);
              }}
            />
          ) : daftar.length === 0 ? (
            <p className="form-hint">Belum ada reservasi.</p>
          ) : (
            <ul className={styles.daftarList}>
              {daftar.map((r) => {
                const info = labelStatusReservasi(r.status);
                const aktif = r.status === 'terjadwal';
                const sedangBatal = membatalkan === r.id;
                return (
                  <li key={r.id} className={styles.reservasiCard}>
                    {aktif && (
                      <div className={styles.reservasiQr}>
                        <QRCodeDisplay value={r.qr_token} size={90} />
                      </div>
                    )}
                    <div className={styles.reservasiInfo}>
                      <div className={styles.daftarBaris}>
                        <span style={{ fontWeight: 700 }}>
                          {r.tujuan === 'bertemu_seseorang'
                            ? `Bertemu: ${r.nama_yang_ditemui ?? '-'}`
                            : namaLayananSaran(r.layanan_saran_id)}
                        </span>
                        <span className={`badge ${info.className}`}>{info.label}</span>
                      </div>
                      <div className={styles.reservasiMeta}>
                        <CalendarPlus size={14} className={styles.reservasiMetaIcon} aria-hidden="true" />
                        {new Date(`${r.tanggal}T00:00:00`).toLocaleDateString('id-ID', {
                          weekday: 'long',
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        })}
                      </div>
                      {r.jam_rencana && (
                        <div className={styles.reservasiMeta}>
                          <Clock size={14} className={styles.reservasiMetaIcon} aria-hidden="true" />
                          {r.jam_rencana.substring(0, 5)} WIB
                        </div>
                      )}
                      {aktif && (
                        <>
                          <p className={styles.daftarCatatan}>
                            Tunjukkan QR ini ke petugas Front Office saat tiba.
                          </p>
                          {konfirmasiBatal === r.id ? (
                            <div className={styles.daftarAksi}>
                              <button
                                type="button"
                                className="btn btn--danger btn--sm"
                                onClick={() => void batalkan(r.id)}
                                disabled={sedangBatal}
                              >
                                {sedangBatal ? 'Membatalkan…' : 'Ya, batalkan'}
                              </button>
                              <button
                                type="button"
                                className="btn btn--secondary btn--sm"
                                onClick={() => setKonfirmasiBatal(null)}
                                disabled={sedangBatal}
                              >
                                Tidak
                              </button>
                            </div>
                          ) : (
                            <div className={styles.daftarAksi}>
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                onClick={() => {
                                  setInfoBatal('');
                                  setGalatBatal('');
                                  setKonfirmasiBatal(r.id);
                                }}
                                disabled={membatalkan !== null}
                              >
                                <XCircle size={14} aria-hidden="true" /> Batalkan reservasi
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
