'use client';

// Panel "Scan QR" pada halaman Registrasi Pengunjung (/admin/fo/registrasi?tab=scan), dulu halaman /admin/scan.
// Scan QR reservasi (Tahap B, alur Front Office; kontrak docs/analysis/FO-ESKALASI-KONTRAK-RPC.md §2.2, §2.3, §6.4).
// Pindai QR -> pratinjau (baca kunjungan, tanpa mengubah apa pun) -> FO memilih:
//   - Check-in: rpc fo_checkin_reservasi (kunjungan jadi `dilayani`, tahap FO `berjalan`, TANPA tiket) lalu lanjut ke
//     /admin/fo/penanganan untuk melayani; nomor antrean baru terbit hanya saat FO mengeskalasi.
//   - Tolak: rpc fo_tolak_reservasi dengan alasan wajib.
// Tidak ada lagi UPDATE `visit` dari klien. Siklus hidup kamera diatur seluruhnya oleh useKameraPemindai: menyala hanya
// selama state `scanning` + dokumen terlihat; mati saat unmount (ganti tab/halaman), disembunyikan, atau galat (audit T9);
// dialog tolak aksesibel (audit T8).
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  QrCode,
  Camera,
  Search,
  CheckCircle2,
  XCircle,
  MapPin,
  User,
  Calendar,
  Clock,
  ArrowRight,
  RotateCcw,
  Loader2,
} from 'lucide-react';
import FoTolakReservasiDialog from '@/components/admin/FoTolakReservasiDialog';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';
import { todayWIB } from '@/lib/time';
import { urlLoginAlasan } from '@/lib/sesi-staf';
import {
  foCheckinReservasi,
  galatSesiTidakSah,
  kodeGalatFo,
  pesanGalatFo,
  type HasilCheckinReservasi,
} from '@/lib/fo-penanganan';
import { useKameraPemindai } from '@/lib/hooks/useKameraPemindai';
import styles from './scan-panel.module.css';

// Pratinjau reservasi (kontrak §6.4). Semua kolom dibaca dari `kunjungan`: sejak WP-24 (migrasi 202610140007) reservasi
// lama sudah dilengkapi/dibuatkan baris `kunjungan`, dan tabel `visit` hanya arsip baca-saja (tidak dibaca lagi di sini).
interface Pratinjau {
  id: string;
  nama: string;
  tanggal: string;
  status: string;
  tujuan: string | null;
  layanan_saran_id: string | null;
  nama_yang_ditemui: string | null;
  keperluan: string | null;
  jam_rencana: string | null;
  asal_instansi: string | null;
  email: string | null;
  /** Token yang dipindai/diketik (dipakai RPC), bukan kolom DB. */
  qr_token: string;
  layananSaranNama: string | null;
}

type ScanState = 'scanning' | 'mencari' | 'found' | 'not_found' | 'hangus' | 'error' | 'processed' | 'ditolak';
type StatusQr = 'tidak_ditemukan' | 'tanggal_lain' | 'sudah_diproses';

// Pesan untuk QR yang tidak terbaca lewat RLS. 'tidak_berlaku' (no_show/batal/lewat tanggal) ditampilkan sebagai 'hangus'.
const PESAN_QR: Record<StatusQr, { judul: string; teks: string }> = {
  tidak_ditemukan: { judul: 'Tidak Ditemukan', teks: 'QR code tidak terdaftar, bukan reservasi, atau tidak berlaku hari ini.' },
  tanggal_lain: { judul: 'Reservasi Tanggal Lain', teks: 'Reservasi ini untuk tanggal lain. Minta pengunjung datang sesuai tanggal reservasinya.' },
  sudah_diproses: { judul: 'Sudah Diproses', teks: 'Reservasi ini sudah di-check-in atau sudah selesai dilayani.' },
};

const LABEL_STATUS: Record<string, string> = {
  menunggu: 'menunggu ditangani',
  dilayani: 'sudah check-in dan sedang dilayani',
  selesai: 'sudah selesai dilayani',
  batal: 'dibatalkan',
  no_show: 'tidak datang',
  tidak_terlayani: 'tidak terlayani',
  terjadwal: 'terjadwal',
};

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function ScanPanel() {
  const { toast } = useToast();
  const router = useRouter();
  const [scanState, setScanState] = useState<ScanState>('scanning');
  // Fase 3: RLS hanya memuat reservasi HARI INI untuk FO biasa; kategori QR lain dari RPC fo_status_qr (tanpa PII).
  const [statusQr, setStatusQr] = useState<StatusQr>('tidak_ditemukan');
  const [result, setResult] = useState<Pratinjau | null>(null);
  const [hasilCheckin, setHasilCheckin] = useState<HasilCheckinReservasi | null>(null);
  const [processing, setProcessing] = useState(false);
  const [dialogTolak, setDialogTolak] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [galatAksi, setGalatAksi] = useState<string | null>(null);
  const [galatCari, setGalatCari] = useState<string | null>(null);
  const scannerRef = useRef<HTMLDivElement>(null);
  const hasilRef = useRef<HTMLDivElement>(null);
  const inputManualRef = useRef<HTMLInputElement>(null);
  // Penjaga di luar siklus render: dekode QR menembak ~10x/dtk, dan klik ganda terjadi sebelum render ulang.
  const sedangCariRef = useRef(false);
  const sedangProsesRef = useRef(false);
  const fokusInputRef = useRef(false);

  // Kamera hanya menyala pada state `scanning`; berpindah state (hasil ditemukan, dsb.) memicu cleanup effect di bawah.
  const memindai = scanState === 'scanning';

  const lookupToken = useCallback(async (tokenMentah: string) => {
    const token = tokenMentah.trim();
    if (!token || sedangCariRef.current) return;
    sedangCariRef.current = true;
    setScanState('mencari');
    setGalatAksi(null);
    setGalatCari(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('kunjungan')
        .select(
          'id, nama, tanggal, status, tujuan, layanan_saran_id, nama_yang_ditemui, keperluan, jam_rencana, asal_instansi, email',
        )
        .eq('qr_token', token)
        .eq('asal', 'reservasi')
        .maybeSingle();

      if (error) {
        console.error('Gagal membaca reservasi:', error);
        setResult(null);
        setGalatCari('Gagal membaca reservasi. Periksa koneksi lalu coba lagi.');
        setScanState('error');
        return;
      }
      if (!data) {
        setResult(null);
        // Kategori saja (tanpa PII); RPC belum ada (migrasi belum diterapkan) / galat -> "tidak ditemukan".
        const { data: kategori, error: eKategori } = await supabase.rpc('fo_status_qr', { p_qr_token: token });
        const kat = eKategori ? null : (kategori as string | null);
        if (kat === 'tidak_berlaku') {
          setScanState('hangus');
          return;
        }
        setStatusQr(kat === 'tanggal_lain' || kat === 'sudah_diproses' ? kat : 'tidak_ditemukan');
        setScanState('not_found');
        return;
      }

      const dasar = data as unknown as Omit<Pratinjau, 'qr_token' | 'layananSaranNama'>;
      const { layanan_saran_id } = dasar;

      let layananSaranNama: string | null = null;
      if (layanan_saran_id) {
        const { data: l } = await supabase.from('layanan').select('nama').eq('id', layanan_saran_id).maybeSingle();
        layananSaranNama = (l as { nama?: string } | null)?.nama ?? null;
      }

      const pratinjau: Pratinjau = {
        ...dasar, qr_token: token, layananSaranNama,
      };
      setResult(pratinjau);

      // QR hangus: sudah no_show (tugas harian) atau tanggal sudah lewat tetapi tugas belum jalan.
      const hangus = pratinjau.status === 'no_show' || (pratinjau.status === 'terjadwal' && pratinjau.tanggal < todayWIB());
      setScanState(hangus ? 'hangus' : 'found');
    } catch (e) {
      console.error('Gagal membaca reservasi:', e);
      setResult(null);
      setGalatCari('Gagal membaca reservasi. Periksa koneksi lalu coba lagi.');
      setScanState('error');
    } finally {
      sedangCariRef.current = false;
    }
  }, []);

  // Kamera dikelola useKameraPemindai: menyala hanya selama `memindai` + dokumen terlihat, mati saat unmount/ganti tab,
  // disembunyikan, atau galat. Setelah dijeda karena disembunyikan, kamera menunggu tombol "Nyalakan Kamera".
  const { status: statusKamera, nyalakan: nyalakanKamera } = useKameraPemindai({
    aktif: memindai,
    wadahRef: scannerRef,
    onDekode: (teks) => { void lookupToken(teks); },
  });
  const kameraGalat = statusKamera === 'galat';

  // Hasil pindai menerima fokus (pembaca layar langsung membacakan hasilnya); kembali memindai -> fokus ke input manual.
  useEffect(() => {
    if (scanState === 'scanning') {
      if (fokusInputRef.current) {
        inputManualRef.current?.focus();
        fokusInputRef.current = false;
      }
    } else if (scanState !== 'mencari' && !document.querySelector('[role="dialog"][aria-modal="true"]')) {
      // Jangan merebut fokus dari dialog yang sedang terbuka (mis. pembacaan ulang di belakang dialog tolak).
      hasilRef.current?.focus();
    }
  }, [scanState]);

  const tanganiGalatAksi = async (e: unknown, awalan: string, token: string) => {
    const kode = kodeGalatFo(e);
    if (galatSesiTidakSah(e)) {
      toast(pesanGalatFo(e), 'error');
      router.replace(urlLoginAlasan('tidak_terdaftar'));
      return;
    }
    if (kode === 'QR_KEDALUWARSA') {
      setScanState('hangus');
      return;
    }
    const pesan = pesanGalatFo(e, 'Terjadi kesalahan.');
    toast(`${awalan} ${pesan}`, 'error');
    if (kode === 'INVALID_STATUS' || kode === 'BUKAN_HARI_INI' || kode === 'NOT_FOUND') {
      // Tampilan reservasi kemungkinan basi: baca ulang dari server, lalu tampilkan alasan penolakan.
      await lookupToken(token);
    }
    setGalatAksi(pesan);
  };

  const handleCheckIn = async () => {
    if (!result || scanState !== 'found' || sedangProsesRef.current) return;
    sedangProsesRef.current = true;
    setProcessing(true);
    setGalatAksi(null);
    try {
      const hasil = await foCheckinReservasi(createClient(), result.qr_token);
      setHasilCheckin(hasil);
      setScanState('processed');
      toast(`${hasil.nama} berhasil check-in. Lanjutkan penanganan.`, 'success');
      router.push('/admin/fo/penanganan');
    } catch (e) {
      console.error('Gagal check-in reservasi:', e);
      await tanganiGalatAksi(e, 'Gagal check-in.', result.qr_token);
    } finally {
      sedangProsesRef.current = false;
      setProcessing(false);
    }
  };

  const handleReset = () => {
    fokusInputRef.current = true;
    // "Scan ulang" adalah tindakan pengguna: boleh menyalakan kamera lagi walau sebelumnya dijeda/galat.
    nyalakanKamera();
    setScanState('scanning');
    setResult(null);
    setHasilCheckin(null);
    setGalatAksi(null);
    setGalatCari(null);
    setManualToken('');
  };

  const handleManualLookup = async () => {
    if (!manualToken.trim()) return;
    await lookupToken(manualToken);
  };

  const hariIni = todayWIB();
  const bisaCheckin = !!result && result.status === 'terjadwal' && result.tanggal === hariIni;
  const bisaTolak = !!result && result.status === 'terjadwal';
  const tujuanTeks = result
    ? result.tujuan === 'bertemu_seseorang'
      ? `Bertemu: ${result.nama_yang_ditemui ?? '-'}`
      : result.layananSaranNama ?? 'Loket layanan (belum memilih layanan)'
    : '';

  return (
    <>
      <div className={styles.scanPage}>
        <div className={styles.scanLayout}>
          {/* Scanner */}
          <div className={styles.scannerCard}>
            <div className={styles.scannerHeader}>
              <Camera size={18} className={styles.scannerHeaderIcon} aria-hidden="true" />
              Kamera Scanner
            </div>
            <div className={styles.scannerBody}>
              {kameraGalat && (
                <div role="alert" className={styles.scannerGalat}>
                  <p>Gagal mengakses kamera. Pastikan izin kamera diberikan, atau masukkan token secara manual di bawah.</p>
                  <button type="button" className="btn btn--secondary btn--sm" onClick={nyalakanKamera}>
                    Coba Lagi
                  </button>
                </div>
              )}
              <div className={styles.scannerPreview} ref={scannerRef} hidden={kameraGalat} />

              {statusKamera === 'dijeda' && (
                <div className={styles.kameraDijeda}>
                  <p>Kamera dimatikan karena halaman sempat tidak terlihat. Nyalakan lagi bila Anda siap memindai.</p>
                  <button type="button" className="btn btn--primary btn--sm" onClick={nyalakanKamera}>
                    <Camera size={16} aria-hidden="true" /> Nyalakan Kamera
                  </button>
                </div>
              )}

              <div
                className={`${styles.scannerStatus} ${
                  statusKamera === 'aktif' || statusKamera === 'menyalakan' ? styles.scannerStatusActive : styles.scannerStatusIdle
                }`}
                role="status"
                aria-live="polite"
              >
                {statusKamera === 'aktif' ? (
                  <><span className={styles.pulsaTitik} aria-hidden="true" /> <span>Kamera aktif</span> <span className={styles.statusTambahan}>· menunggu scan</span></>
                ) : statusKamera === 'menyalakan' ? (
                  <><Loader2 size={14} className="animate-spin" aria-hidden="true" /> <span>Menyalakan kamera…</span></>
                ) : (
                  <><QrCode size={14} aria-hidden="true" /> <span>Kamera mati</span></>
                )}
              </div>

              {/* Manual input */}
              <div className={styles.manualInput}>
                <label htmlFor="scan-token-manual" className={styles.manualLabel}>
                  Atau masukkan token secara manual:
                </label>
                <div className={styles.manualInputRow}>
                  <input
                    id="scan-token-manual"
                    ref={inputManualRef}
                    type="text"
                    className="form-input"
                    placeholder="Tempel token QR di sini…"
                    value={manualToken}
                    onChange={(e) => setManualToken(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleManualLookup(); }}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    onClick={() => void handleManualLookup()}
                    disabled={scanState === 'mencari'}
                    aria-label="Cari token"
                  >
                    <Search size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Result */}
          <div className={styles.resultCard}>
            <h2 className={styles.resultHeader}>Informasi Pengunjung</h2>
            <div className={styles.resultBody} ref={hasilRef} tabIndex={-1} aria-live="polite">
              {scanState === 'scanning' && (
                <div className={styles.resultEmpty}>
                  <QrCode size={48} className={styles.resultEmptyIcon} aria-hidden="true" />
                  <h3 className={styles.judulHasil}>Menunggu Scan</h3>
                  <p className={styles.teksHasil}>Arahkan kamera ke QR code pengunjung</p>
                </div>
              )}

              {scanState === 'mencari' && (
                <div className={styles.resultEmpty}>
                  <Loader2 size={40} className="animate-spin" aria-hidden="true" />
                  <p className={styles.teksHasil}>Mencari reservasi…</p>
                </div>
              )}

              {scanState === 'error' && (
                <div className={styles.notFound}>
                  <XCircle size={48} className={styles.notFoundIcon} aria-hidden="true" />
                  <h3 className={styles.judulHasil}>Gagal Membaca</h3>
                  <p className={styles.teksHasil}>{galatCari}</p>
                  <button type="button" className="btn btn--secondary btn--sm" onClick={handleReset}>
                    <RotateCcw size={14} aria-hidden="true" /> Scan Ulang
                  </button>
                </div>
              )}

              {scanState === 'not_found' && (
                <div className={styles.notFound}>
                  <XCircle size={48} className={styles.notFoundIcon} aria-hidden="true" />
                  <h3 className={styles.judulHasil}>{PESAN_QR[statusQr].judul}</h3>
                  <p className={styles.teksHasil}>{PESAN_QR[statusQr].teks}</p>
                  <button type="button" className="btn btn--secondary btn--sm" onClick={handleReset}>
                    <RotateCcw size={14} aria-hidden="true" /> Scan Ulang
                  </button>
                </div>
              )}

              {scanState === 'hangus' && (
                <div className={styles.notFound}>
                  <XCircle size={48} className={styles.notFoundIcon} aria-hidden="true" />
                  <h3 className={styles.judulHasil}>QR Sudah Hangus</h3>
                  <p className={styles.teksHasil}>
                    Reservasi ini kedaluwarsa karena pengunjung tidak datang pada jadwalnya
                    {result?.tanggal ? ` (${formatDate(result.tanggal)})` : ''}. QR code tidak dapat digunakan lagi.
                    Minta pengunjung membuat reservasi baru.
                  </p>
                  <button type="button" className="btn btn--secondary btn--sm" onClick={handleReset}>
                    <RotateCcw size={14} aria-hidden="true" /> Scan Ulang
                  </button>
                </div>
              )}

              {scanState === 'found' && result && (
                <div className={styles.visitorInfo}>
                  <div className={styles.visitorHeader}>
                    <div className={styles.visitorAvatarFallback} aria-hidden="true">
                      {result.nama.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className={styles.visitorName}>{result.nama}</div>
                      <div className={styles.visitorEmail}>
                        {[result.asal_instansi, result.email].filter(Boolean).join(' · ') || 'Data kontak tidak tersedia'}
                      </div>
                    </div>
                  </div>

                  <div className={styles.detailGrid}>
                    <div className={styles.detailItem}>
                      <div className={styles.detailIcon} aria-hidden="true">
                        {result.tujuan === 'bertemu_seseorang' ? <User size={18} /> : <MapPin size={18} />}
                      </div>
                      <div>
                        <div className={styles.detailLabel}>Tujuan</div>
                        <div className={styles.detailValue}>{tujuanTeks}</div>
                      </div>
                    </div>

                    <div className={styles.detailItem}>
                      <div className={styles.detailIcon} aria-hidden="true"><Calendar size={18} /></div>
                      <div>
                        <div className={styles.detailLabel}>Tanggal</div>
                        <div className={styles.detailValue}>{formatDate(result.tanggal)}</div>
                      </div>
                    </div>

                    {result.jam_rencana && (
                      <div className={styles.detailItem}>
                        <div className={styles.detailIcon} aria-hidden="true"><Clock size={18} /></div>
                        <div>
                          <div className={styles.detailLabel}>Jam</div>
                          <div className={styles.detailValue}>{result.jam_rencana.substring(0, 5)} WIB</div>
                        </div>
                      </div>
                    )}

                    {result.keperluan && (
                      <div className={styles.detailItem}>
                        <div className={styles.detailIcon} aria-hidden="true"><Search size={18} /></div>
                        <div>
                          <div className={styles.detailLabel}>Keperluan</div>
                          <div className={styles.detailValue}>{result.keperluan}</div>
                        </div>
                      </div>
                    )}
                  </div>

                  {result.status !== 'terjadwal' && (
                    <p className={styles.peringatan}>
                      Reservasi ini sudah diproses (status: {LABEL_STATUS[result.status] ?? result.status}). Check-in
                      ditolak karena tidak boleh dipindai ulang.
                    </p>
                  )}
                  {result.status === 'terjadwal' && result.tanggal !== hariIni && (
                    <p className={styles.peringatan}>
                      Jadwal reservasi ini {formatDate(result.tanggal)}, bukan hari ini, sehingga belum dapat check-in.
                    </p>
                  )}
                  {galatAksi && <p role="alert" className={styles.galatAksi}>{galatAksi}</p>}

                  <div className={styles.actionButtons}>
                    {bisaCheckin && (
                      <button
                        type="button"
                        className="btn btn--primary btn--lg"
                        style={{ width: '100%' }}
                        onClick={() => void handleCheckIn()}
                        disabled={processing}
                        aria-busy={processing}
                      >
                        {processing ? (
                          <><Loader2 size={18} className="animate-spin" aria-hidden="true" /> Memproses...</>
                        ) : (
                          <><ArrowRight size={18} aria-hidden="true" /> Check-in &amp; mulai layani</>
                        )}
                      </button>
                    )}

                    {bisaTolak && (
                      <button
                        type="button"
                        className="btn btn--danger btn--lg"
                        style={{ width: '100%' }}
                        onClick={() => setDialogTolak(true)}
                        disabled={processing}
                      >
                        <XCircle size={18} aria-hidden="true" />
                        Tolak Pengunjung
                      </button>
                    )}

                    <button type="button" className="btn btn--ghost btn--sm" onClick={handleReset} disabled={processing}>
                      <RotateCcw size={14} aria-hidden="true" />
                      Scan Pengunjung Lain
                    </button>
                  </div>
                </div>
              )}

              {scanState === 'processed' && (
                <div className={styles.scanSuccess}>
                  <div className={styles.scanSuccessIcon} aria-hidden="true">
                    <CheckCircle2 size={32} />
                  </div>
                  <h3 className={styles.judulHasil}>Check-in Berhasil</h3>
                  <p className={styles.teksHasil}>
                    {hasilCheckin?.nama ?? result?.nama} sudah tercatat hadir dan kini Anda layani. Membuka halaman
                    Penanganan…
                  </p>
                </div>
              )}

              {scanState === 'ditolak' && (
                <div className={styles.scanSuccess}>
                  <div className={styles.scanSuccessIcon} aria-hidden="true">
                    <CheckCircle2 size={32} />
                  </div>
                  <h3 className={styles.judulHasil}>Reservasi Ditolak</h3>
                  <p className={styles.teksHasil}>Reservasi {result?.nama} dibatalkan dan tercatat beserta alasannya.</p>
                  <button type="button" className="btn btn--primary btn--lg" onClick={handleReset}>
                    <QrCode size={18} aria-hidden="true" />
                    Scan Pengunjung Berikutnya
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {dialogTolak && result && (
        <FoTolakReservasiDialog
          qrToken={result.qr_token}
          namaPengunjung={result.nama}
          onClose={() => setDialogTolak(false)}
          onBerhasil={() => {
            setDialogTolak(false);
            setScanState('ditolak');
            toast(`Reservasi ${result.nama} ditolak`, 'success');
          }}
          onGalatSistem={(e) => {
            if (galatSesiTidakSah(e)) {
              router.replace(urlLoginAlasan('tidak_terdaftar'));
              return;
            }
            const kode = kodeGalatFo(e);
            // Status reservasi di layar basi (sudah berubah di tempat lain): segarkan di belakang dialog.
            if (kode === 'INVALID_STATUS' || kode === 'NOT_FOUND') void lookupToken(result.qr_token);
          }}
        />
      )}
    </>
  );
}
