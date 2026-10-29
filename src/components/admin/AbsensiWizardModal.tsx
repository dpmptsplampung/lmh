'use client';

import { useEffect, useRef, useCallback, useReducer, useState } from 'react';
import { X, ChevronRight, ChevronLeft, Camera, CheckCircle2, Loader2, ImagePlus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';
import { todayWIB } from '@/lib/time';
import { kompresBerkas, kompresKeJpeg } from '@/lib/foto/kompres';
import { unggahKeR2 } from '@/lib/storage/unggah';

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
  streaming: boolean;
};

const INITIAL: WizardState = {
  step: 1,
  selectedLayananId: '',
  nama: '',
  foto: null,
  layananList: [],
  streaming: false,
};

type WizardAction =
  | { type: 'RESET' }
  | { type: 'SET_STEP'; step: Step }
  | { type: 'SET_LAYANAN'; id: string }
  | { type: 'SET_NAMA'; nama: string }
  | { type: 'SET_FOTO'; foto: { blob: Blob; url: string } | null }
  | { type: 'SET_LAYANAN_LIST'; list: Layanan[] }
  | { type: 'SET_STREAMING'; value: boolean };

function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'RESET':             return INITIAL;
    case 'SET_STEP':          return { ...state, step: action.step };
    case 'SET_LAYANAN':       return { ...state, selectedLayananId: action.id };
    case 'SET_NAMA':          return { ...state, nama: action.nama };
    case 'SET_FOTO':          return { ...state, foto: action.foto };
    case 'SET_LAYANAN_LIST':  return { ...state, layananList: action.list };
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
  const streamRef = useRef<MediaStream | null>(null);

  // ── Helpers (deklarasikan sebelum effects) ────────────────────────────────
  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    dispatch({ type: 'SET_STREAMING', value: false });
  }, []);

  const loadLayanan = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.from('layanan').select('id, nama').is('diarsipkan_at', null).order('nama');
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
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog" aria-modal="true" aria-labelledby="aw-title"
      style={{
        position: 'fixed', inset: 0,
        backgroundColor: 'rgba(15,23,42,0.45)',
        zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-4)',
      }}
    >
      <div style={{
        background: '#ffffff',
        borderRadius: 'var(--radius-2xl, 16px)',
        width: '100%', maxWidth: '520px',
        boxShadow: '0 10px 40px rgba(15, 23, 42, 0.12), 0 2px 6px rgba(15, 23, 42, 0.04)',
        border: '1px solid var(--border-default, #e2e8f0)',
        overflowX: 'hidden',
        overflowY: 'auto',
        maxHeight: 'calc(100dvh - 2rem)',
      }}>
        {/* Header */}
        <div style={{
          padding: 'var(--space-5) var(--space-6)',
          borderBottom: '1px solid var(--border-default, #e2e8f0)',
          background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <h2 id="aw-title" style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 700 }}>
              Catat Hadir Petugas
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              Langkah {w.step} dari 3 —&nbsp;
              {w.step === 1 && 'Pilih Layanan'}
              {w.step === 2 && 'Foto Petugas'}
              {w.step === 3 && 'Nama Petugas'}
            </p>
          </div>
          <button onClick={onClose} className="btn btn--ghost btn--sm"
            style={{ borderRadius: '50%', padding: 6 }} aria-label="Tutup">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 'var(--space-6)' }}>

          {/* ── Step 1: Pilih Layanan ── */}
          {w.step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                Pilih layanan tempat petugas bertugas:
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {w.layananList.map(l => (
                  <button key={l.id}
                    onClick={() => dispatch({ type: 'SET_LAYANAN', id: l.id })}
                    style={{
                      padding: 'var(--space-3) var(--space-4)',
                      borderRadius: 'var(--radius-lg)',
                      border: w.selectedLayananId === l.id
                        ? '2px solid var(--color-primary-600, #0284c7)'
                        : '1px solid var(--border-default, #e2e8f0)',
                      background: w.selectedLayananId === l.id
                        ? 'var(--color-primary-50, #f0f9ff)'
                        : 'var(--surface-default, #fff)',
                      cursor: 'pointer', textAlign: 'left',
                      fontSize: 'var(--text-sm)', fontWeight: 500,
                      color: w.selectedLayananId === l.id
                        ? 'var(--color-primary-700, #0369a1)'
                        : 'var(--text-primary)',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {l.nama}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Step 2: Webcam ── */}
          {w.step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', alignItems: 'center' }}>
              {w.foto ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={w.foto.url} alt="Foto petugas"
                    style={{ width: '100%', maxWidth: 400, borderRadius: 'var(--radius-lg)',
                      border: '1px solid var(--border-default)' }} />
                  <button className="btn btn--ghost btn--sm" onClick={retakePhoto}>
                    <Camera size={16} /> Ulangi Foto
                  </button>
                </>
              ) : (
                <>
                  <div style={{ position: 'relative', width: '100%', maxWidth: 400 }}>
                    <video ref={videoRef} playsInline muted
                      style={{ width: '100%', borderRadius: 'var(--radius-lg)',
                        border: '1px solid var(--border-default)',
                        background: '#000', display: w.streaming ? 'block' : 'none' }} />
                    {!w.streaming && (
                      <div style={{
                        width: '100%', height: 240, borderRadius: 'var(--radius-lg)',
                        border: '1px dashed var(--border-default)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'var(--text-tertiary)', flexDirection: 'column', gap: 8,
                      }}>
                        <Camera size={32} />
                        <span style={{ fontSize: 'var(--text-sm)' }}>Kamera belum aktif</span>
                      </div>
                    )}
                  </div>
                  <input ref={berkasRef} type="file" accept="image/*" capture="user" hidden
                    onChange={e => { void pilihBerkas(e.target.files?.[0]); e.target.value = ''; }} />
                  {!w.streaming ? (
                    <button className="btn btn--primary" onClick={() => void startCamera()}>
                      <Camera size={16} /> Aktifkan Kamera
                    </button>
                  ) : (
                    <button className="btn btn--primary" onClick={() => void capturePhoto()}>
                      <Camera size={16} /> Ambil Foto
                    </button>
                  )}
                  <button className="btn btn--ghost btn--sm" onClick={() => berkasRef.current?.click()}>
                    <ImagePlus size={16} /> Pilih dari galeri / kamera ponsel
                  </button>
                </>
              )}
            </div>
          )}

          {/* ── Step 3: Nama manual ── */}
          {w.step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {w.foto && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={w.foto.url} alt="Foto petugas"
                  style={{ width: 96, height: 96, borderRadius: '50%',
                    objectFit: 'cover', border: '2px solid var(--color-primary-300)',
                    alignSelf: 'center' }} />
              )}
              <p style={{ margin: 0, textAlign: 'center', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                {w.layananList.find(l => l.id === w.selectedLayananId)?.nama}
              </p>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>
                  Nama Petugas <span style={{ color: 'var(--color-error)' }}>*</span>
                </span>
                <input className="input" type="text" autoFocus autoComplete="off" maxLength={100}
                  placeholder="Ketik nama lengkap petugas"
                  value={w.nama}
                  onChange={e => dispatch({ type: 'SET_NAMA', nama: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter') void handleSelesai(); }} />
              </label>
            </div>
          )}

        </div>

        {/* Footer */}
        <div style={{
          padding: 'var(--space-4) var(--space-6)',
          borderTop: '1px solid var(--border-default, #e2e8f0)',
          display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)',
        }}>
          {w.step > 1 ? (
            <button className="btn btn--ghost btn--sm" onClick={handleBack} disabled={submitting}>
              <ChevronLeft size={16} /> Kembali
            </button>
          ) : <div />}

          {w.step === 1 && (
            <button className="btn btn--primary"
              onClick={handleNextToWebcam}
              disabled={!w.selectedLayananId}>
              <ChevronRight size={16} />
              Lanjut
            </button>
          )}
          {w.step === 2 && (
            <button className="btn btn--primary" onClick={handleNextToNama} disabled={!w.foto}>
              <ChevronRight size={16} /> Lanjut
            </button>
          )}
          {w.step === 3 && (
            <button className="btn btn--primary" onClick={() => void handleSelesai()}
              disabled={submitting || w.nama.trim().length < 2}>
              {submitting
                ? <><Loader2 size={16} className="animate-spin" /> Menyimpan…</>
                : <><CheckCircle2 size={16} /> Selesai</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
