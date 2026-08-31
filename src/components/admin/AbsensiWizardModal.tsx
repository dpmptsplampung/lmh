'use client';

import { useEffect, useRef, useCallback, useReducer, useState } from 'react';
import { X, ChevronRight, ChevronLeft, Camera, CheckCircle2, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';
import { todayWIB } from '@/lib/time';

interface Layanan { id: string; nama: string; }
interface Petugas { id: string; nama: string; }

interface AbsensiWizardModalProps {
  isOpen: boolean;
  /** ID petugas FO yang sedang login (yang mencatat hadir) */
  foId: string;
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
  selectedPetugasId: string;
  fotoDataUrl: string | null;
  layananList: Layanan[];
  petugasList: Petugas[];
  streaming: boolean;
};

const INITIAL: WizardState = {
  step: 1,
  selectedLayananId: '',
  selectedPetugasId: '',
  fotoDataUrl: null,
  layananList: [],
  petugasList: [],
  streaming: false,
};

type WizardAction =
  | { type: 'RESET' }
  | { type: 'SET_STEP'; step: Step }
  | { type: 'SET_LAYANAN'; id: string }
  | { type: 'SET_PETUGAS'; id: string }
  | { type: 'SET_FOTO'; dataUrl: string | null }
  | { type: 'SET_LAYANAN_LIST'; list: Layanan[] }
  | { type: 'SET_PETUGAS_LIST'; list: Petugas[] }
  | { type: 'SET_STREAMING'; value: boolean };

function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'RESET':             return INITIAL;
    case 'SET_STEP':          return { ...state, step: action.step };
    case 'SET_LAYANAN':       return { ...state, selectedLayananId: action.id };
    case 'SET_PETUGAS':       return { ...state, selectedPetugasId: action.id };
    case 'SET_FOTO':          return { ...state, fotoDataUrl: action.dataUrl };
    case 'SET_LAYANAN_LIST':  return { ...state, layananList: action.list };
    case 'SET_PETUGAS_LIST':  return { ...state, petugasList: action.list };
    case 'SET_STREAMING':     return { ...state, streaming: action.value };
    default:                  return state;
  }
}

export default function AbsensiWizardModal({
  isOpen, foId, onClose, onSuccess,
}: AbsensiWizardModalProps) {
  const { toast } = useToast();

  const [w, dispatch] = useReducer(reducer, INITIAL);
  // loading & submitting diset dari event handler — boleh useState
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
    const { data } = await supabase.from('layanan').select('id, nama').order('nama');
    dispatch({ type: 'SET_LAYANAN_LIST', list: data ?? [] });
  }, []);

  const loadPetugas = useCallback(async (layananId: string) => {
    if (!layananId) { dispatch({ type: 'SET_PETUGAS_LIST', list: [] }); return; }
    const supabase = createClient();
    const { data } = await supabase
      .from('petugas').select('id, nama')
      .eq('layanan_id', layananId).eq('aktif', true).order('nama');
    dispatch({ type: 'SET_PETUGAS_LIST', list: data ?? [] });
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
  const handleNextToWebcam = async () => {
    if (!w.selectedLayananId) { toast('Pilih layanan terlebih dahulu', 'warning'); return; }
    setLoading(true);
    await loadPetugas(w.selectedLayananId);
    setLoading(false);
    dispatch({ type: 'SET_STEP', step: 2 });
  };

  const handleNextToNama = () => {
    if (!w.fotoDataUrl) { toast('Ambil foto terlebih dahulu', 'warning'); return; }
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

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    dispatch({ type: 'SET_FOTO', dataUrl: canvas.toDataURL('image/jpeg', 0.85) });
    stopStream();
  };

  const retakePhoto = () => {
    dispatch({ type: 'SET_FOTO', dataUrl: null });
    void startCamera();
  };

  // ── Finalisasi ────────────────────────────────────────────────────────────
  const handleSelesai = async () => {
    if (!w.selectedPetugasId) { toast('Pilih nama petugas terlebih dahulu', 'warning'); return; }
    if (!w.fotoDataUrl) { toast('Foto wajib diambil', 'warning'); return; }

    try {
      setSubmitting(true);
      const supabase = createClient();

      const blob = await (await fetch(w.fotoDataUrl)).blob();
      const filePath = `${todayWIB()}/${w.selectedPetugasId}_${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('absensi-foto')
        .upload(filePath, blob, { contentType: 'image/jpeg', upsert: false });
      if (uploadError) throw new Error(`Upload foto gagal: ${uploadError.message}`);

      const { error: rpcError } = await supabase.rpc('catat_absensi', {
        p_petugas_id:   w.selectedPetugasId,
        p_sumber:       'fo',
        p_dicatat_oleh: foId,
        p_foto_url:     filePath,
      });
      if (rpcError) throw new Error(rpcError.message);

      toast('Absensi berhasil dicatat', 'success');
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
        overflow: 'hidden',
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
              {w.step === 2 && 'Foto dengan Webcam'}
              {w.step === 3 && 'Konfirmasi Nama'}
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
                Pilih layanan yang akan dicatat kehadirannya:
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
              {w.fotoDataUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={w.fotoDataUrl} alt="Foto preview"
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
                  <canvas ref={canvasRef} style={{ display: 'none' }} />
                  {!w.streaming ? (
                    <button className="btn btn--primary" onClick={() => void startCamera()}>
                      <Camera size={16} /> Aktifkan Kamera
                    </button>
                  ) : (
                    <button className="btn btn--primary" onClick={capturePhoto}>
                      <Camera size={16} /> Ambil Foto
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Step 3: Konfirmasi Nama ── */}
          {w.step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {w.fotoDataUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={w.fotoDataUrl} alt="Foto"
                  style={{ width: 80, height: 80, borderRadius: '50%',
                    objectFit: 'cover', border: '2px solid var(--color-primary-300)',
                    alignSelf: 'center' }} />
              )}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>
                  Nama Petugas <span style={{ color: 'var(--color-error)' }}>*</span>
                </span>
                {w.petugasList.length > 0 ? (
                  <select className="input" value={w.selectedPetugasId}
                    onChange={e => dispatch({ type: 'SET_PETUGAS', id: e.target.value })}>
                    <option value="">— Pilih petugas —</option>
                    {w.petugasList.map(p => (
                      <option key={p.id} value={p.id}>{p.nama}</option>
                    ))}
                  </select>
                ) : (
                  <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-warning-700)' }}>
                    Tidak ada petugas aktif untuk layanan ini.
                  </p>
                )}
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
              onClick={() => void handleNextToWebcam()}
              disabled={loading || !w.selectedLayananId}>
              {loading ? <Loader2 size={16} className="animate-spin" /> : <ChevronRight size={16} />}
              Lanjut
            </button>
          )}
          {w.step === 2 && (
            <button className="btn btn--primary" onClick={handleNextToNama} disabled={!w.fotoDataUrl}>
              <ChevronRight size={16} /> Lanjut
            </button>
          )}
          {w.step === 3 && (
            <button className="btn btn--primary" onClick={() => void handleSelesai()}
              disabled={submitting || !w.selectedPetugasId}>
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
