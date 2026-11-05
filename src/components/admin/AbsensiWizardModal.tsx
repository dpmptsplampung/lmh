'use client';

import { useEffect, useRef, useCallback, useReducer, useState } from 'react';
import { ChevronRight, ChevronLeft, Camera, CheckCircle2, ImagePlus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';
import { todayWIB } from '@/lib/time';
import { kompresBerkas, kompresKeJpeg } from '@/lib/foto/kompres';
import { unggahKeR2 } from '@/lib/storage/unggah';
import { objekBelumAda } from '@/lib/akses-data/galat';
import ErrorRetry from '@/components/ErrorRetry';
import Dialog from '@/components/ui/Dialog';
import Field from '@/components/ui/Field';
import Tombol from '@/components/ui/Tombol';
import { cn } from '@/lib/utils';
import styles from './AbsensiWizardModal.module.css';

interface Layanan { id: string; nama: string; }

interface AbsensiWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type Step = 1 | 2 | 3;

// ── Semua state wizard dalam satu reducer ─────────────────────────────────────
// (mencegah react-hooks/set-state-in-effect: hanya dispatch yang dipanggil
//  dari dalam effect, bukan useState setter)
type WizardState = {
  step: Step;
  selectedLayananId: string;
  nama: string;
  /** Foto terkompresi (JPEG) + URL pratinjau (blob:) */
  foto: { blob: Blob; url: string } | null;
  layananList: Layanan[];
  /** Status muat daftar layanan; galat tidak boleh tampil sebagai daftar kosong (C-08). */
  layananStatus: 'memuat' | 'siap' | 'galat';
  layananGalat: string;
  streaming: boolean;
};

const INITIAL: WizardState = {
  step: 1,
  selectedLayananId: '',
  nama: '',
  foto: null,
  layananList: [],
  layananStatus: 'memuat',
  layananGalat: '',
  streaming: false,
};

type WizardAction =
  | { type: 'RESET' }
  | { type: 'SET_STEP'; step: Step }
  | { type: 'SET_LAYANAN'; id: string }
  | { type: 'SET_NAMA'; nama: string }
  | { type: 'SET_FOTO'; foto: { blob: Blob; url: string } | null }
  | { type: 'SET_LAYANAN_LIST'; list: Layanan[] }
  | { type: 'LAYANAN_MEMUAT' }
  | { type: 'LAYANAN_GALAT'; pesan: string }
  | { type: 'SET_STREAMING'; value: boolean };

function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'RESET':             return INITIAL;
    case 'SET_STEP':          return { ...state, step: action.step };
    case 'SET_LAYANAN':       return { ...state, selectedLayananId: action.id };
    case 'SET_NAMA':          return { ...state, nama: action.nama };
    case 'SET_FOTO':          return { ...state, foto: action.foto };
    case 'SET_LAYANAN_LIST':  return { ...state, layananList: action.list, layananStatus: 'siap', layananGalat: '' };
    case 'LAYANAN_MEMUAT':    return { ...state, layananStatus: 'memuat', layananGalat: '' };
    case 'LAYANAN_GALAT':      return { ...state, layananList: [], layananStatus: 'galat', layananGalat: action.pesan };
    case 'SET_STREAMING':     return { ...state, streaming: action.value };
    default:                  return state;
  }
}

export default function AbsensiWizardModal({
  isOpen, onClose, onSuccess,
}: AbsensiWizardModalProps) {
  const { toast } = useToast();

  const [w, dispatch] = useReducer(reducer, INITIAL);
  // submitting diset dari event handler — boleh useState
  const [submitting, setSubmitting] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const berkasRef = useRef<HTMLInputElement>(null);
  const namaRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Kunci sinkron kirim (C-03): state `submitting` baru terbaca pada render berikutnya, jadi Enter beruntun lolos.
  const kirimRef = useRef(false);
  // Hanya permintaan daftar layanan terakhir yang boleh menulis state (hasil basi dibuang).
  const permintaanLayananRef = useRef(0);

  // ── Helpers (deklarasikan sebelum effects) ────────────────────────────────
  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    dispatch({ type: 'SET_STREAMING', value: false });
  }, []);

  const loadLayanan = useCallback(async () => {
    const nomor = ++permintaanLayananRef.current;
    dispatch({ type: 'LAYANAN_MEMUAT' });
    const supabase = createClient();
    // Arsip = aktif === false (sumber kebenaran DB, sama dengan Kelola Layanan); diarsipkan_at bisa kosong pada data lama.
    const { data, error } = await supabase.from('layanan').select('id, nama').eq('aktif', true).order('nama');
    if (nomor !== permintaanLayananRef.current) return;
    if (error) {
      dispatch({
        type: 'LAYANAN_GALAT',
        pesan: objekBelumAda(error)
          ? 'Daftar layanan belum bisa dimuat: migrasi database belum diterapkan. Hubungi admin.'
          : 'Daftar layanan gagal dimuat. Periksa koneksi, lalu coba lagi.',
      });
      return;
    }
    dispatch({ type: 'SET_LAYANAN_LIST', list: data ?? [] });
  }, []);

  // ── Effects: hanya dispatch (reducer) — tidak ada useState setter ─────────
  useEffect(() => {
    if (isOpen) {
      dispatch({ type: 'RESET' });
      void loadLayanan();
    } else {
      stopStream();
    }
  }, [isOpen, loadLayanan, stopStream]);

  // Fokus ke isian nama saat langkah 3 tampil (pengganti autoFocus).
  useEffect(() => {
    if (isOpen && w.step === 3) namaRef.current?.focus();
  }, [isOpen, w.step]);

  // Cleanup saat unmount
  useEffect(() => {
    return () => stopStream();
  }, [stopStream]);

  // ── Navigasi ──────────────────────────────────────────────────────────────
  const handleNextToWebcam = () => {
    if (!w.selectedLayananId) { toast('Pilih layanan terlebih dahulu', 'warning'); return; }
    dispatch({ type: 'SET_STEP', step: 2 });
  };

  const handleNextToNama = () => {
    if (!w.foto) { toast('Ambil foto terlebih dahulu', 'warning'); return; }
    stopStream(); // hentikan kamera sebelum pindah ke step 3
    dispatch({ type: 'SET_STEP', step: 3 });
  };

  const handleBack = () => {
    const prev = (w.step - 1) as Step;
    if (w.step === 2) stopStream(); // keluar dari webcam step → hentikan kamera
    dispatch({ type: 'SET_STEP', step: prev });
  };

  // ── Webcam ────────────────────────────────────────────────────────────────
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      dispatch({ type: 'SET_STREAMING', value: true });
    } catch {
      toast('Tidak dapat mengakses kamera. Pastikan izin kamera sudah diberikan.', 'error');
    }
  };

  const setFoto = (blob: Blob | null) => {
    if (w.foto) URL.revokeObjectURL(w.foto.url);
    dispatch({ type: 'SET_FOTO', foto: blob ? { blob, url: URL.createObjectURL(blob) } : null });
  };

  const capturePhoto = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    try {
      // Dikompres di browser: sisi terpanjang 1280 px, JPEG kualitas 0,82 (puluhan-ratusan KB, tetap tajam).
      setFoto(await kompresKeJpeg(video, video.videoWidth, video.videoHeight));
      stopStream();
    } catch {
      toast('Gagal mengambil foto. Coba lagi.', 'error');
    }
  };

  const pilihBerkas = async (berkas: File | undefined) => {
    if (!berkas) return;
    if (!berkas.type.startsWith('image/')) { toast('Pilih berkas gambar', 'warning'); return; }
    try {
      setFoto(await kompresBerkas(berkas));
      stopStream();
    } catch {
      toast('Gambar tidak dapat dibaca', 'error');
    }
  };

  const retakePhoto = () => {
    setFoto(null);
    void startCamera();
  };

  // Bersihkan URL pratinjau saat modal ditutup/dibongkar
  useEffect(() => () => { if (w.foto) URL.revokeObjectURL(w.foto.url); }, [w.foto]);

  // ── Finalisasi ────────────────────────────────────────────────────────────
  const handleSelesai = async () => {
    const nama = w.nama.trim().replace(/\s+/g, ' ');
    if (nama.length < 2) { toast('Ketik nama petugas (minimal 2 huruf)', 'warning'); return; }
    if (!w.foto) { toast('Foto wajib diambil', 'warning'); return; }
    if (kirimRef.current) return;
    kirimRef.current = true;

    try {
      setSubmitting(true);
      // Foto ke Cloudflare R2 (kunci: absensi-foto/<tanggal>/<layanan_id>_<ts>.jpg); DB hanya menyimpan path-nya.
      const path = `${todayWIB()}/${w.selectedLayananId}_${Date.now()}.jpg`;
      try {
        await unggahKeR2('absensi-foto', path, w.foto.blob);
      } catch (e) {
        throw new Error(`Upload foto gagal: ${e instanceof Error ? e.message : 'coba lagi'}`);
      }

      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc('fo_catat_hadir_layanan', {
        p_layanan_id: w.selectedLayananId,
        p_nama: nama,
        p_foto_path: path,
      });
      if (rpcError) {
        throw new Error(rpcError.code === '23505' ? 'Petugas ini sudah tercatat hadir hari ini' : rpcError.message);
      }

      toast(`Kehadiran ${nama} berhasil dicatat`, 'success');
      onSuccess();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal mencatat absensi', 'error');
    } finally {
      kirimRef.current = false;
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const namaLayananDipilih = w.layananList.find((l) => l.id === w.selectedLayananId)?.nama;
  const labelLangkah = w.step === 1 ? 'Pilih Layanan' : w.step === 2 ? 'Foto Petugas' : 'Nama Petugas';

  return (
    <Dialog
      terbuka
      onTutup={onClose}
      dikunci={submitting}
      judul="Catat Hadir Petugas"
      deskripsi={`Langkah ${w.step} dari 3 — ${labelLangkah}`}
      kaki={(
        <div className={styles.kaki}>
          {w.step > 1 ? (
            <Tombol varian="hantu" ukuran="kecil" ikon={ChevronLeft} onClick={handleBack} disabled={submitting}>
              Kembali
            </Tombol>
          ) : <span />}

          {w.step === 1 && (
            <Tombol varian="utama" ikon={ChevronRight} onClick={handleNextToWebcam} disabled={!w.selectedLayananId}>
              Lanjut
            </Tombol>
          )}
          {w.step === 2 && (
            <Tombol varian="utama" ikon={ChevronRight} onClick={handleNextToNama} disabled={!w.foto}>
              Lanjut
            </Tombol>
          )}
          {w.step === 3 && (
            <Tombol
              varian="utama"
              ikon={CheckCircle2}
              onClick={() => void handleSelesai()}
              disabled={submitting || w.nama.trim().length < 2}
              memuat={submitting}
            >
              {submitting ? 'Menyimpan…' : 'Selesai'}
            </Tombol>
          )}
        </div>
      )}
    >
      {/* ── Step 1: Pilih Layanan ── */}
      {w.step === 1 && (
        <div className={styles.kolom}>
          <p className={styles.petunjuk}>Pilih layanan tempat petugas bertugas:</p>
          {w.layananStatus === 'memuat' && (
            <p role="status" className={styles.catatan}>Memuat daftar layanan…</p>
          )}
          {w.layananStatus === 'galat' && (
            <ErrorRetry pesan={w.layananGalat} onRetry={() => void loadLayanan()} />
          )}
          {w.layananStatus === 'siap' && w.layananList.length === 0 && (
            <p role="status" className={styles.petunjuk}>
              Belum ada layanan aktif. Hubungi admin untuk menambahkan layanan.
            </p>
          )}
          <div className={styles.pilihan}>
            {w.layananList.map((l) => (
              <button
                key={l.id}
                type="button"
                aria-pressed={w.selectedLayananId === l.id}
                onClick={() => dispatch({ type: 'SET_LAYANAN', id: l.id })}
                className={cn(styles.pilihanTombol, w.selectedLayananId === l.id && styles.pilihanAktif)}
              >
                {l.nama}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Step 2: Webcam ── */}
      {w.step === 2 && (
        <div className={cn(styles.kolom, styles.tengah)}>
          {w.foto ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={w.foto.url} alt="Foto petugas" className={styles.foto} />
              <Tombol varian="hantu" ukuran="kecil" ikon={Camera} onClick={retakePhoto}>
                Ulangi Foto
              </Tombol>
            </>
          ) : (
            <>
              <div className={styles.kamera}>
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className={cn(styles.video, !w.streaming && styles.sembunyi)}
                />
                {!w.streaming && (
                  <div className={styles.kameraKosong}>
                    <Camera size={32} strokeWidth={1.75} aria-hidden="true" />
                    <span>Kamera belum aktif</span>
                  </div>
                )}
              </div>
              <input ref={berkasRef} type="file" accept="image/*" capture="user" hidden
                onChange={e => { void pilihBerkas(e.target.files?.[0]); e.target.value = ''; }} />
              {!w.streaming ? (
                <Tombol varian="utama" ikon={Camera} onClick={() => void startCamera()}>
                  Aktifkan Kamera
                </Tombol>
              ) : (
                <Tombol varian="utama" ikon={Camera} onClick={() => void capturePhoto()}>
                  Ambil Foto
                </Tombol>
              )}
              <Tombol varian="hantu" ukuran="kecil" ikon={ImagePlus} onClick={() => berkasRef.current?.click()}>
                Pilih dari galeri / kamera ponsel
              </Tombol>
            </>
          )}
        </div>
      )}

      {/* ── Step 3: Nama manual ── */}
      {w.step === 3 && (
        <div className={styles.kolom}>
          {w.foto && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={w.foto.url} alt="Foto petugas" className={styles.fotoBulat} />
          )}
          {namaLayananDipilih && <p className={styles.layananDipilih}>{namaLayananDipilih}</p>}
          <Field label="Nama Petugas" wajib>
            <input
              ref={namaRef}
              className="form-input"
              type="text"
              autoComplete="off"
              maxLength={100}
              placeholder="Ketik nama lengkap petugas"
              value={w.nama}
              onChange={e => dispatch({ type: 'SET_NAMA', nama: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter' && !submitting) void handleSelesai(); }}
            />
          </Field>
        </div>
      )}
    </Dialog>
  );
}
