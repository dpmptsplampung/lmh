'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { todayWIB, addDaysWIB } from '@/lib/time';
import {
  CalendarCheck,
  CalendarPlus,
  MapPin,
  User,
  CheckCircle2,
  Send,
  Clock,
  Users,
  XCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatTanggal } from '@/lib/utils';
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
import PageHeader from '@/components/layout/PageHeader';
import Kartu from '@/components/ui/Kartu';
import Field from '@/components/ui/Field';
import Lencana, { type NadaLencana } from '@/components/ui/Lencana';
import PemilihTanggal from '@/components/ui/PemilihTanggal';
import Skeleton from '@/components/ui/Skeleton';
import StatusKosong from '@/components/ui/StatusKosong';
import Tombol from '@/components/ui/Tombol';
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
  // C2-01: gagal memuat layanan (jaringan/DB) harus beda dari daftar kosong yang sah -> ErrorRetry + Coba lagi.
  const [layananGalat, setLayananGalat] = useState(false);
  const [layananMemuat, setLayananMemuat] = useState(false);
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

  const muatLayananOpsi = useCallback(async () => {
    setLayananMemuat(true);
    try {
      const { data, error: fetchError } = await createClient()
        .from('v_layanan_publik')
        .select('id, nama, status_tampilan, punya_antrean')
        .neq('tipe', 'modul_publik')
        .order('nama');
      if (fetchError) throw fetchError;
      setLayananOptions((data || []).filter((l) => l.punya_antrean !== false));
      setLayananGalat(false);
    } catch {
      setLayananOptions([]);
      setLayananGalat(true);
    } finally {
      setLayananMemuat(false);
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
      await muatLayananOpsi();

      setLoadingInit(false);
    }

    loadInitData();
  }, [muatDaftar, muatLayananOpsi]);

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
          ? formatTanggal(`${jadwalBerikutnya}T12:00:00+07:00`, { weekday: 'long', year: undefined })
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
      <div className={styles.halaman}>
        <PageHeader title="Rencanakan Kedatangan" description="Memuat formulir reservasi." />
        <Skeleton bentuk="kartu" jumlah={2} label="Memuat formulir reservasi" />
      </div>
    );
  }

  const nadaReservasi = (status: string): NadaLencana => {
    switch (status) {
      case 'terjadwal':
        return 'info';
      case 'menunggu':
        return 'peringatan';
      case 'dilayani':
      case 'selesai':
        return 'sukses';
      case 'no_show':
      case 'tidak_terlayani':
        return 'bahaya';
      default:
        return 'netral';
    }
  };

  return (
    <div className={styles.halaman}>
      <PageHeader
        title="Rencanakan Kedatangan"
        description="Booking kunjungan Anda ke kantor DPMPTSP. Setelah selesai, Anda akan mendapatkan QR code yang dipindai petugas Front Office saat Anda tiba."
        kembali={{ href: '/me', label: 'Kembali ke Beranda saya' }}
      />

      <div className={styles.kolom}>
        <Kartu className={styles.formCard} judul={success ? 'Reservasi Berhasil' : 'Data kunjungan'}>
          {success ? (
            <div className={styles.berhasil}>
              <span className={styles.berhasilIkon}>
                <CheckCircle2 size={28} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <p className={styles.berhasilTeks}>
                Simpan QR code ini dan tunjukkan ke petugas saat Anda tiba di kantor DPMPTSP.
              </p>

              <div className={styles.qrWrapper}>
                <QRCodeDisplay value={success.qr_token} size={180} />
                <p className={styles.qrHint}>
                  Tunjukkan QR code ini ke petugas Front Office untuk dipindai saat tiba di kantor
                </p>
                <p className={styles.qrHint}>
                  QR ini juga tersimpan di daftar Reservasi Saya.
                </p>
              </div>

              <div className={styles.aksiBerhasil}>
                <Tombol href="/me">Kembali ke Beranda saya</Tombol>
                <Tombol
                  varian="sekunder"
                  ikon={CalendarPlus}
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
                  Buat Reservasi Lain
                </Tombol>
              </div>
            </div>
          ) : (
            <form className={styles.formBody} onSubmit={handleSubmit}>
              {/* Tujuan */}
              <div className={styles.grup}>
                <span className={styles.labelGrup}>
                  Tujuan Kunjungan <span className={styles.bintang} aria-hidden="true">*</span>
                </span>
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
                      <MapPin size={20} strokeWidth={1.75} />
                    </span>
                    <span>
                      <span className={styles.tujuanLabel}>Menuju Loket Layanan</span>
                      <span className={styles.tujuanHint}>Pilih layanan yang ingin Anda datangi</span>
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
                      <User size={20} strokeWidth={1.75} />
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
                <div className={styles.grup}>
                  {layananGalat ? (
                    <>
                      <span className={styles.labelGrup}>Layanan Tujuan</span>
                      <ErrorRetry
                        judul="Daftar layanan belum dapat dimuat"
                        pesan="Periksa koneksi Anda lalu coba lagi. Anda belum dapat memilih layanan tujuan."
                        onRetry={() => void muatLayananOpsi()}
                        memuat={layananMemuat}
                      />
                    </>
                  ) : layananOptions.length === 0 ? (
                    <>
                      <span className={styles.labelGrup}>Layanan Tujuan</span>
                      <p className={styles.bantuan}>Belum ada layanan yang dapat direservasi saat ini.</p>
                    </>
                  ) : (
                    <Field label="Layanan Tujuan" wajib>
                      <select
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
                    </Field>
                  )}
                  {/* A-07: v_antrian_loket = antrean HARI INI; tidak relevan untuk tanggal reservasi lain. */}
                  {form.layanan_id && estimasiLayanan && (!form.tanggal_rencana || form.tanggal_rencana === minDate) && (
                    <p className={styles.estimasiInline}>
                      <Clock size={16} strokeWidth={1.75} aria-hidden="true" />
                      <span>
                        Antrean hari ini: ~{estimasiLayanan.estimasi_tunggu_total_menit} menit,&nbsp;
                        <Users size={14} strokeWidth={1.75} className={styles.ikonSebaris} aria-hidden="true" />
                        {' '}{estimasiLayanan.antre_count} antre
                      </span>
                    </p>
                  )}
                </div>
              )}

              {/* Nama yang ditemui (jika bertemu) */}
              {form.tujuan === 'bertemu_seseorang' && (
                <Field label="Nama yang Ingin Ditemui" wajib>
                  <input
                    type="text"
                    placeholder="Masukkan nama lengkap"
                    value={form.nama_yang_ditemui}
                    onChange={(e) => setForm({ ...form, nama_yang_ditemui: e.target.value })}
                  />
                </Field>
              )}

              {/* Tanggal */}
              <Field
                label="Tanggal Kedatangan"
                wajib
                bantuan={
                  form.tujuan === 'loket'
                    ? `Mengikuti jadwal layanan yang dipilih (sebagian layanan juga buka hari Sabtu). Bila layanan tutup di tanggal itu, kami tunjukkan jadwal terdekat. Maksimal ${MAX_BOOKING_DAYS} hari ke depan.`
                    : form.tujuan === 'bertemu_seseorang'
                      ? `Bertemu seseorang hanya hari kerja (Senin–Jumat) dan bukan hari libur. Maksimal ${MAX_BOOKING_DAYS} hari ke depan.`
                      : `Hari yang tersedia mengikuti tujuan kunjungan yang Anda pilih. Maksimal ${MAX_BOOKING_DAYS} hari ke depan.`
                }
              >
                {(p) => (
                  <PemilihTanggal
                    id={p.id}
                    aria-describedby={p['aria-describedby']}
                    label="Tanggal Kedatangan"
                    nilai={form.tanggal_rencana}
                    onUbah={(tanggal) => setForm({ ...form, tanggal_rencana: tanggal })}
                    min={minDate}
                    max={maxDate}
                  />
                )}
              </Field>

              {/* Jam (opsional) */}
              <Field label="Perkiraan Jam Kedatangan" bantuan="Opsional — membantu petugas mempersiapkan layanan">
                <input
                  type="time"
                  value={form.jam_rencana}
                  onChange={(e) => setForm({ ...form, jam_rencana: e.target.value })}
                />
              </Field>

              {/* Keperluan */}
              <Field label="Keperluan">
                <textarea
                  placeholder="Jelaskan secara singkat keperluan Anda (opsional)"
                  value={form.keperluan}
                  onChange={(e) => setForm({ ...form, keperluan: e.target.value })}
                  rows={3}
                />
              </Field>

              {consentGagal ? (
                <ErrorRetry
                  judul="Reservasi belum dibuat"
                  pesan="Persetujuan belum tercatat, coba lagi"
                  onRetry={() => void handleSubmit()}
                />
              ) : (
                error && (
                  <p className={styles.galatForm} role="alert">
                    {error}
                  </p>
                )
              )}

              {/* Consent PDP — wajib sebelum submit */}
              <div className={styles.consent}>
                <input
                  id="consent"
                  type="checkbox"
                  className={styles.consentKotak}
                  checked={consentGiven}
                  onChange={(e) => setConsentGiven(e.target.checked)}
                  required
                />
                <label htmlFor="consent" className={styles.consentTeks}>
                  {CONSENT_TEXT}{' '}
                  <Link href="/kebijakan-privasi" className={styles.consentTautan}>
                    Baca kebijakan
                  </Link>
                </label>
              </div>

              <Tombol
                type="submit"
                ikon={Send}
                memuat={loading}
                disabled={!consentGiven || (form.tujuan === 'loket' && layananOptions.length === 0)}
                className={styles.kirim}
              >
                {loading ? 'Memproses...' : 'Buat Reservasi'}
              </Tombol>
            </form>
          )}
        </Kartu>

        {/* Reservasi Saya: baris kunjungan (kontrak §6.6), QR untuk yang masih terjadwal */}
        <Kartu className={styles.daftarKartu} judul="Reservasi Saya">
          <div role="status" aria-live="polite">
            {infoBatal && <p className={styles.daftarInfo}>{infoBatal}</p>}
          </div>
          {galatBatal && (
            <p className={styles.galatForm} role="alert">
              {galatBatal}
            </p>
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
            <StatusKosong
              ikon={CalendarCheck}
              judul="Belum ada reservasi."
              isi="Reservasi yang Anda buat akan muncul di sini beserta QR code-nya."
            />
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
                        <span className={styles.reservasiNama}>
                          {r.tujuan === 'bertemu_seseorang'
                            ? `Bertemu: ${r.nama_yang_ditemui ?? '-'}`
                            : namaLayananSaran(r.layanan_saran_id)}
                        </span>
                        <Lencana nada={nadaReservasi(r.status)}>{info.label}</Lencana>
                      </div>
                      <div className={styles.reservasiMeta}>
                        <CalendarPlus size={14} strokeWidth={1.75} className={styles.reservasiMetaIcon} aria-hidden="true" />
                        {formatTanggal(`${r.tanggal}T12:00:00+07:00`, { weekday: 'long' })}
                      </div>
                      {r.jam_rencana && (
                        <div className={styles.reservasiMeta}>
                          <Clock size={14} strokeWidth={1.75} className={styles.reservasiMetaIcon} aria-hidden="true" />
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
                              <Tombol
                                varian="bahaya"
                                ukuran="kecil"
                                onClick={() => void batalkan(r.id)}
                                disabled={sedangBatal}
                              >
                                {sedangBatal ? 'Membatalkan…' : 'Ya, batalkan'}
                              </Tombol>
                              <Tombol
                                varian="sekunder"
                                ukuran="kecil"
                                onClick={() => setKonfirmasiBatal(null)}
                                disabled={sedangBatal}
                              >
                                Tidak
                              </Tombol>
                            </div>
                          ) : (
                            <div className={styles.daftarAksi}>
                              <Tombol
                                varian="hantu"
                                ukuran="kecil"
                                ikon={XCircle}
                                onClick={() => {
                                  setInfoBatal('');
                                  setGalatBatal('');
                                  setKonfirmasiBatal(r.id);
                                }}
                                disabled={membatalkan !== null}
                              >
                                Batalkan reservasi
                              </Tombol>
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
        </Kartu>
      </div>
    </div>
  );
}
