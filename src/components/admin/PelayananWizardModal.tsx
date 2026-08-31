'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Loader2,
  Save,
  CheckCircle2,
  FileText,
  Building2,
  User,
  Phone,
  Mail,
  Lock,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import { useToast } from '@/components/Toast';
import {
  SKALA_USAHA_OPTIONS,
  TIPE_PELAKU_USAHA_OPTIONS,
  TIPE_PELAKU_USAHA_LABELS,
  STATUS_PENANAMAN_MODAL_OPTIONS,
  STATUS_PENANAMAN_MODAL_LABELS,
  TINDAK_LANJUT_OSS_OPTIONS,
  OPD_TEKNIS_OPTIONS,
  TINDAK_LANJUT_PERIZINAN_OPTIONS,
  PelayananInitialData,
  FormPelayananType,
} from '@/lib/types/pelayanan';

interface PelayananWizardModalProps {
  isOpen: boolean;
  tiketId: string | null;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function PelayananWizardModal({
  isOpen,
  tiketId,
  onClose,
  onSuccess,
}: PelayananWizardModalProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [initialData, setInitialData] = useState<PelayananInitialData | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [savingDraft, setSavingDraft] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // Form State — Prapopulasi / Umum
  const [namaPemohon, setNamaPemohon] = useState('');
  const [alamatPemohon, setAlamatPemohon] = useState('');
  const [noHp, setNoHp] = useState('');
  const [email, setEmail] = useState('');
  const [keperluanAwal, setKeperluanAwal] = useState('');

  // Form State — Helpdesk OSS (Dengan 3 field opsional baru)
  const [namaUsaha, setNamaUsaha] = useState('');
  const [tipePelakuUsaha, setTipePelakuUsaha] = useState<string>('');
  const [statusPenanamanModal, setStatusPenanamanModal] = useState<string>('');
  const [lokasiUsaha, setLokasiUsaha] = useState('');
  const [skalaUsaha, setSkalaUsaha] = useState<string>('');
  const [sektorUsahaKbli, setSektorUsahaKbli] = useState('');
  const [tindakLanjutOss, setTindakLanjutOss] = useState<string>('');
  const [uraianSolusi, setUraianSolusi] = useState('');
  const [catatanInternal, setCatatanInternal] = useState('');

  // Form State — Perizinan DPMPTSP
  const [namaPerusahaan, setNamaPerusahaan] = useState('');
  const [opdTeknis, setOpdTeknis] = useState<string>('');
  const [uraianPermohonan, setUraianPermohonan] = useState('');
  const [tindakLanjutPerizinan, setTindakLanjutPerizinan] = useState<string>('');
  const [catatanPetugas, setCatatanPetugas] = useState('');

  const isLocked = initialData?.is_locked ?? false;
  const formType: FormPelayananType | null = initialData?.form_type ?? null;
  const autosaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Bersihkan autosave tertunda saat komponen unmount agar tidak ada PATCH
  // liar terpicu setelah modal ditutup / komponen dibongkar.
  useEffect(() => {
    return () => {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
        autosaveTimeoutRef.current = null;
      }
    };
  }, []);

  // 1. Fetch data saat modal dibuka
  const loadData = useCallback(
    async (id: string, isCurrent: () => boolean) => {
      try {
        setLoading(true);
        setValidationErrors({});
        const res = await fetch(`/api/admin/pelayanan/${id}`);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Gagal memuat data pelayanan');
        }
        const data: PelayananInitialData = await res.json();
        if (!isCurrent()) return;

        setInitialData(data);

        // Prapopulasi data identitas
        setNamaPemohon(data.nama_pemohon || '');
        setAlamatPemohon(data.alamat_pemohon || '');
        setNoHp(data.no_hp || '');
        setEmail(data.email || '');
        setKeperluanAwal(data.keperluan_awal || '');

        // Prapopulasi form OSS
        if (data.form_type === 'oss' && data.data_oss) {
          setNamaUsaha(data.data_oss.nama_usaha || '');
          setTipePelakuUsaha(data.data_oss.tipe_pelaku_usaha || '');
          setStatusPenanamanModal(data.data_oss.status_penanaman_modal || '');
          setLokasiUsaha(data.data_oss.lokasi_usaha || '');
          setSkalaUsaha(data.data_oss.skala_usaha || '');
          setSektorUsahaKbli(data.data_oss.sektor_usaha_kbli || '');
          setTindakLanjutOss(data.data_oss.tindak_lanjut || '');
          setUraianSolusi(data.data_oss.uraian_solusi || '');
          setCatatanInternal(data.data_oss.catatan_internal || '');
        }

        // Prapopulasi form Perizinan
        if (data.form_type === 'perizinan' && data.data_perizinan) {
          setNamaPerusahaan(data.data_perizinan.nama_perusahaan || '');
          setOpdTeknis(data.data_perizinan.opd_teknis || '');
          setUraianPermohonan(data.data_perizinan.uraian_permohonan || '');
          setTindakLanjutPerizinan(data.data_perizinan.tindak_lanjut || '');
          setCatatanPetugas(data.data_perizinan.catatan_petugas || '');
        }

        setStep(1);
      } catch (e) {
        if (!isCurrent()) return;
        toast(e instanceof Error ? e.message : 'Gagal memuat data', 'error');
        onClose();
      } finally {
        if (isCurrent()) {
          setLoading(false);
        }
      }
    },
    [toast, onClose]
  );

  useEffect(() => {
    let active = true;
    if (isOpen && tiketId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadData(tiketId, () => active);
    }
    return () => {
      active = false;
    };
  }, [isOpen, tiketId, loadData]);

  // 2. Autosave Function (Debounced)
  const saveDraftNow = useCallback(async () => {
    if (!tiketId || isLocked || !formType) return;
    try {
      setSavingDraft(true);
      const payload =
        formType === 'oss'
          ? {
              nama_pemohon: namaPemohon,
              alamat_pemohon: alamatPemohon,
              no_hp: noHp,
              email: email,
              keperluan_awal: keperluanAwal,
              nama_usaha: namaUsaha,
              tipe_pelaku_usaha: tipePelakuUsaha || null,
              status_penanaman_modal: statusPenanamanModal || null,
              lokasi_usaha: lokasiUsaha || null,
              skala_usaha: skalaUsaha || null,
              sektor_usaha_kbli: sektorUsahaKbli,
              tindak_lanjut: tindakLanjutOss,
              uraian_solusi: uraianSolusi,
              catatan_internal: catatanInternal,
            }
          : {
              nama_pemohon: namaPemohon,
              alamat_pemohon: alamatPemohon,
              no_hp: noHp,
              email: email,
              keperluan_awal: keperluanAwal,
              nama_perusahaan: namaPerusahaan,
              opd_teknis: opdTeknis,
              uraian_permohonan: uraianPermohonan,
              tindak_lanjut: tindakLanjutPerizinan,
              catatan_petugas: catatanPetugas,
            };

      const res = await fetch(`/api/admin/pelayanan/${tiketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const d = new Date();
        setLastSavedTime(
          d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        );
      }
    } catch {
      // Autosave fail silently or log
    } finally {
      setSavingDraft(false);
    }
  }, [
    tiketId,
    isLocked,
    formType,
    namaPemohon,
    alamatPemohon,
    noHp,
    email,
    keperluanAwal,
    namaUsaha,
    tipePelakuUsaha,
    statusPenanamanModal,
    lokasiUsaha,
    skalaUsaha,
    sektorUsahaKbli,
    tindakLanjutOss,
    uraianSolusi,
    catatanInternal,
    namaPerusahaan,
    opdTeknis,
    uraianPermohonan,
    tindakLanjutPerizinan,
    catatanPetugas,
  ]);

  const triggerAutosave = useCallback(() => {
    if (isLocked || loading) return;
    if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current);
    autosaveTimeoutRef.current = setTimeout(() => {
      saveDraftNow();
    }, 1000);
  }, [isLocked, loading, saveDraftNow]);

  // 3. Finalize / Selesaikan Pelayanan
  const handleFinalize = async () => {
    if (!tiketId || !formType) return;
    setValidationErrors({});
    const errors: Record<string, string> = {};

    // Validasi Client-Side
    if (formType === 'oss') {
      if (!namaPemohon.trim()) errors.nama_pemohon = 'Nama pemohon wajib diisi';
      if (!namaUsaha.trim()) errors.nama_usaha = 'Nama usaha wajib diisi';
      if (!uraianSolusi.trim()) errors.uraian_solusi = 'Uraian solusi / konsultasi wajib diisi';
      if (!tindakLanjutOss.trim()) errors.tindak_lanjut = 'Tindak lanjut / tindakan wajib diisi';
    } else {
      if (!namaPemohon.trim()) errors.nama_pemohon = 'Nama pemohon wajib diisi';
      if (!namaPerusahaan.trim()) errors.nama_perusahaan = 'Nama perusahaan wajib diisi';
      if (!opdTeknis.trim()) errors.opd_teknis = 'OPD teknis wajib dipilih / diisi';
      if (!uraianPermohonan.trim()) errors.uraian_permohonan = 'Uraian permohonan wajib diisi';
      if (!tindakLanjutPerizinan.trim()) errors.tindak_lanjut = 'Tindak lanjut wajib dipilih / diisi';
    }

    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      toast('Lengkapi seluruh field wajib bertanda bintang (*)', 'error');
      return;
    }

    try {
      setFinalizing(true);
      const payload =
        formType === 'oss'
          ? {
              nama_pemohon: namaPemohon.trim(),
              alamat_pemohon: alamatPemohon.trim() || null,
              no_hp: noHp.trim() || null,
              email: email.trim() || null,
              keperluan_awal: keperluanAwal.trim() || null,
              nama_usaha: namaUsaha.trim(),
              tipe_pelaku_usaha: tipePelakuUsaha || null,
              status_penanaman_modal: statusPenanamanModal || null,
              lokasi_usaha: lokasiUsaha.trim() || null,
              skala_usaha: skalaUsaha || null,
              sektor_usaha_kbli: sektorUsahaKbli.trim() || null,
              tindak_lanjut: tindakLanjutOss.trim(),
              uraian_solusi: uraianSolusi.trim(),
              catatan_internal: catatanInternal.trim() || null,
            }
          : {
              nama_pemohon: namaPemohon.trim(),
              alamat_pemohon: alamatPemohon.trim() || null,
              no_hp: noHp.trim() || null,
              email: email.trim() || null,
              keperluan_awal: keperluanAwal.trim() || null,
              nama_perusahaan: namaPerusahaan.trim(),
              opd_teknis: opdTeknis.trim(),
              uraian_permohonan: uraianPermohonan.trim(),
              tindak_lanjut: tindakLanjutPerizinan.trim(),
              catatan_petugas: catatanPetugas.trim() || null,
            };

      const res = await fetch(`/api/admin/pelayanan/${tiketId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || 'Gagal menyelesaikan pelayanan');
      }

      toast('Pelayanan selesai & data berhasil dikunci', 'success');
      onSuccess?.();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal menyelesaikan pelayanan', 'error');
    } finally {
      setFinalizing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pw-title"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.7)',
        backdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-4)',
      }}
    >
      <div
        style={{
          background: 'var(--surface-elevated, #ffffff)',
          borderRadius: 'var(--radius-2xl, 16px)',
          width: '100%',
          maxWidth: '760px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          border: '1px solid var(--border-default, #e2e8f0)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: 'var(--space-5) var(--space-6)',
            borderBottom: '1px solid var(--border-default, #e2e8f0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-secondary, #f8fafc)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <h2
                id="pw-title"
                style={{
                  fontSize: 'var(--text-lg, 1.125rem)',
                  fontWeight: 700,
                  margin: 0,
                  color: 'var(--text-primary, #0f172a)',
                }}
              >
                Pendataan Pelayanan — {initialData?.layanan_nama || 'Loket'}
              </h2>
              {isLocked ? (
                <span className="badge badge--aktif" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Lock size={12} /> Terkunci (Selesai)
                </span>
              ) : (
                <span className="badge badge--draft">Sedang Dilayani</span>
              )}
            </div>
            <p
              style={{
                fontSize: 'var(--text-xs, 0.75rem)',
                color: 'var(--text-tertiary, #64748b)',
                margin: '2px 0 0 0',
              }}
            >
              Nomor Tiket: <strong style={{ color: 'var(--color-primary-700, #0369a1)' }}>{initialData?.nomor_display}</strong>
              {lastSavedTime && !isLocked && ` · Draft tersimpan ${lastSavedTime}`}
              {savingDraft && ' · Menyimpan draft…'}
            </p>
          </div>

          <button
            onClick={() => {
              saveDraftNow();
              onClose();
            }}
            className="btn btn--ghost btn--sm"
            style={{ borderRadius: '50%', padding: '6px' }}
            aria-label="Tutup"
          >
            <X size={18} />
          </button>
        </div>

        {/* Steps Navigation */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border-default, #e2e8f0)',
            background: '#ffffff',
          }}
        >
          {[
            { s: 1, label: '1. Profil Pemohon', icon: User },
            { s: 2, label: '2. Data Usaha & Lokasi', icon: Building2 },
            { s: 3, label: '3. Tindakan & Solusi', icon: FileText },
          ].map((item) => {
            const Icon = item.icon;
            const isActive = step === item.s;
            return (
              <button
                key={item.s}
                onClick={() => setStep(item.s as 1 | 2 | 3)}
                style={{
                  flex: 1,
                  padding: 'var(--space-3) var(--space-4)',
                  fontSize: 'var(--text-sm, 0.875rem)',
                  fontWeight: isActive ? 700 : 500,
                  color: isActive ? 'var(--color-primary-700, #0369a1)' : 'var(--text-secondary, #475569)',
                  borderBottom: isActive ? '2px solid var(--color-primary-600, #0284c7)' : '2px solid transparent',
                  background: isActive ? 'var(--color-primary-50, #f0f9ff)' : 'transparent',
                  borderTop: 'none',
                  borderLeft: 'none',
                  borderRight: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  transition: 'all 0.15s ease',
                }}
              >
                <Icon size={16} />
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Modal Body (Scrollable) */}
        <div
          style={{
            padding: 'var(--space-6)',
            overflowY: 'auto',
            flex: 1,
          }}
        >
          {loading ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-12)', color: 'var(--text-secondary)' }}>
              <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto var(--space-3)' }} />
              <p>Memuat formulir pendataan…</p>
            </div>
          ) : (
            <form onSubmit={(e) => e.preventDefault()}>
              {/* STEP 1: PROFIL PEMOHON */}
              {step === 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  <div className="form-group">
                    <label className="form-label form-label--required">Nama Pemohon</label>
                    <input
                      type="text"
                      className="form-input"
                      value={namaPemohon}
                      disabled={isLocked}
                      onChange={(e) => {
                        setNamaPemohon(e.target.value);
                        triggerAutosave();
                      }}
                      placeholder="Nama lengkap pemohon"
                    />
                    {validationErrors.nama_pemohon && (
                      <p className="form-error" style={{ color: 'var(--color-danger-600)', fontSize: 12, marginTop: 4 }}>
                        {validationErrors.nama_pemohon}
                      </p>
                    )}
                  </div>

                  <div className="form-group">
                    <label className="form-label">Asal Instansi / Alamat Domisili (Opsional)</label>
                    <input
                      type="text"
                      className="form-input"
                      value={alamatPemohon}
                      disabled={isLocked}
                      onChange={(e) => {
                        setAlamatPemohon(e.target.value);
                        triggerAutosave();
                      }}
                      placeholder="Kabupaten/Kota atau alamat domisili pemohon"
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                    <div className="form-group">
                      <label className="form-label">
                        <Phone size={14} style={{ display: 'inline', marginRight: 4 }} />
                        Nomor Handphone / WhatsApp (Opsional)
                      </label>
                      <input
                        type="tel"
                        className="form-input"
                        value={noHp}
                        disabled={isLocked}
                        onChange={(e) => {
                          setNoHp(e.target.value);
                          triggerAutosave();
                        }}
                        placeholder="081234567890"
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">
                        <Mail size={14} style={{ display: 'inline', marginRight: 4 }} />
                        Alamat Email (Opsional)
                      </label>
                      <input
                        type="email"
                        className="form-input"
                        value={email}
                        disabled={isLocked}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          triggerAutosave();
                        }}
                        placeholder="nama@email.com"
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Keperluan Awal (Opsional)</label>
                    <textarea
                      className="form-textarea"
                      rows={2}
                      value={keperluanAwal}
                      disabled={isLocked}
                      onChange={(e) => {
                        setKeperluanAwal(e.target.value);
                        triggerAutosave();
                      }}
                      placeholder="Catatan keperluan saat pendaftaran awal"
                    />
                  </div>
                </div>
              )}

              {/* STEP 2: DATA PELAYANAN TEKNIS */}
              {step === 2 && formType === 'oss' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  <div className="form-group">
                    <label className="form-label form-label--required">Nama Usaha / Merk Usaha</label>
                    <input
                      type="text"
                      className="form-input"
                      value={namaUsaha}
                      disabled={isLocked}
                      onChange={(e) => {
                        setNamaUsaha(e.target.value);
                        triggerAutosave();
                      }}
                      placeholder="Nama PT / CV / Toko / Usaha Perorangan"
                    />
                    {validationErrors.nama_usaha && (
                      <p className="form-error" style={{ color: 'var(--color-danger-600)', fontSize: 12, marginTop: 4 }}>
                        {validationErrors.nama_usaha}
                      </p>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                    <div className="form-group">
                      <label className="form-label">Tipe Pelaku Usaha (Opsional)</label>
                      <select
                        className="form-select"
                        value={tipePelakuUsaha}
                        disabled={isLocked}
                        onChange={(e) => {
                          setTipePelakuUsaha(e.target.value);
                          triggerAutosave();
                        }}
                      >
                        <option value="">-- Pilih Tipe Pelaku Usaha (Opsional) --</option>
                        {TIPE_PELAKU_USAHA_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {TIPE_PELAKU_USAHA_LABELS[opt]}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label className="form-label">Status Penanaman Modal (Opsional)</label>
                      <select
                        className="form-select"
                        value={statusPenanamanModal}
                        disabled={isLocked}
                        onChange={(e) => {
                          setStatusPenanamanModal(e.target.value);
                          triggerAutosave();
                        }}
                      >
                        <option value="">-- Pilih Status Penanaman Modal (Opsional) --</option>
                        {STATUS_PENANAMAN_MODAL_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {STATUS_PENANAMAN_MODAL_LABELS[opt]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Lokasi Usaha (Opsional)</label>
                    <input
                      type="text"
                      className="form-input"
                      value={lokasiUsaha}
                      disabled={isLocked}
                      onChange={(e) => {
                        setLokasiUsaha(e.target.value);
                        triggerAutosave();
                      }}
                      placeholder="Kabupaten/Kota atau wilayah lokasi kegiatan usaha (mis. Bandar Lampung)"
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                    <div className="form-group">
                      <label className="form-label">Skala Usaha (Opsional)</label>
                      <select
                        className="form-select"
                        value={skalaUsaha}
                        disabled={isLocked}
                        onChange={(e) => {
                          setSkalaUsaha(e.target.value);
                          triggerAutosave();
                        }}
                      >
                        <option value="">-- Pilih Skala Usaha (Opsional) --</option>
                        {SKALA_USAHA_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label className="form-label">KBLI / Sektor Usaha (Opsional)</label>
                      <input
                        type="text"
                        className="form-input"
                        value={sektorUsahaKbli}
                        disabled={isLocked}
                        onChange={(e) => {
                          setSektorUsahaKbli(e.target.value);
                          triggerAutosave();
                        }}
                        placeholder="Contoh: 47111 - Perdagangan Eceran"
                      />
                    </div>
                  </div>
                </div>
              )}

              {step === 2 && formType === 'perizinan' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  <div className="form-group">
                    <label className="form-label form-label--required">Nama Perusahaan / Pemohon</label>
                    <input
                      type="text"
                      className="form-input"
                      value={namaPerusahaan}
                      disabled={isLocked}
                      onChange={(e) => {
                        setNamaPerusahaan(e.target.value);
                        triggerAutosave();
                      }}
                      placeholder="Nama PT / CV / Koperasi / Perorangan Pemohon"
                    />
                    {validationErrors.nama_perusahaan && (
                      <p className="form-error" style={{ color: 'var(--color-danger-600)', fontSize: 12, marginTop: 4 }}>
                        {validationErrors.nama_perusahaan}
                      </p>
                    )}
                  </div>

                  <div className="form-group">
                    <label className="form-label form-label--required">OPD Teknis Terkait</label>
                    <input
                      type="text"
                      list="list-opd-teknis"
                      className="form-input"
                      value={opdTeknis}
                      disabled={isLocked}
                      onChange={(e) => {
                        setOpdTeknis(e.target.value);
                        triggerAutosave();
                      }}
                      placeholder="Pilih atau ketik nama OPD Teknis (mis. Dinas ESDM, DLH, dll)"
                    />
                    <datalist id="list-opd-teknis">
                      {OPD_TEKNIS_OPTIONS.map((opt) => (
                        <option key={opt} value={opt} />
                      ))}
                    </datalist>
                    {validationErrors.opd_teknis && (
                      <p className="form-error" style={{ color: 'var(--color-danger-600)', fontSize: 12, marginTop: 4 }}>
                        {validationErrors.opd_teknis}
                      </p>
                    )}
                  </div>

                  <div className="form-group">
                    <label className="form-label form-label--required">Uraian Permohonan / Izin</label>
                    <textarea
                      className="form-textarea"
                      rows={3}
                      value={uraianPermohonan}
                      disabled={isLocked}
                      onChange={(e) => {
                        setUraianPermohonan(e.target.value);
                        triggerAutosave();
                      }}
                      placeholder="Uraian permohonan izin/non-perizinan atau dokumen yang diajukan..."
                    />
                    {validationErrors.uraian_permohonan && (
                      <p className="form-error" style={{ color: 'var(--color-danger-600)', fontSize: 12, marginTop: 4 }}>
                        {validationErrors.uraian_permohonan}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* STEP 3: TINDAKAN & SOLUSI */}
              {step === 3 && formType === 'oss' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  <div className="form-group">
                    <label className="form-label form-label--required">Tindakan / Tindak Lanjut</label>
                    <input
                      type="text"
                      list="list-tindakan-oss"
                      className="form-input"
                      value={tindakLanjutOss}
                      disabled={isLocked}
                      onChange={(e) => {
                        setTindakLanjutOss(e.target.value);
                        triggerAutosave();
                      }}
                      placeholder="Pilih atau ketik tindakan yang diambil..."
                    />
                    <datalist id="list-tindakan-oss">
                      {TINDAK_LANJUT_OSS_OPTIONS.map((opt) => (
                        <option key={opt} value={opt} />
                      ))}
                    </datalist>
                    {validationErrors.tindak_lanjut && (
                      <p className="form-error" style={{ color: 'var(--color-danger-600)', fontSize: 12, marginTop: 4 }}>
                        {validationErrors.tindak_lanjut}
                      </p>
                    )}
                  </div>

                  <div className="form-group">
                    <label className="form-label form-label--required">Uraian Solusi / Konsultasi</label>
                    <textarea
                      className="form-textarea"
                      rows={4}
                      value={uraianSolusi}
                      disabled={isLocked}
                      onChange={(e) => {
                        setUraianSolusi(e.target.value);
                        triggerAutosave();
                      }}
                      placeholder="Tuliskan kendala dan langkah solusi / konsultasi yang diberikan di loket..."
                    />
                    {validationErrors.uraian_solusi && (
                      <p className="form-error" style={{ color: 'var(--color-danger-600)', fontSize: 12, marginTop: 4 }}>
                        {validationErrors.uraian_solusi}
                      </p>
                    )}
                  </div>

                  <div className="form-group">
                    <label className="form-label">Catatan Tambahan Internal (Opsional)</label>
                    <textarea
                      className="form-textarea"
                      rows={2}
                      value={catatanInternal}
                      disabled={isLocked}
                      onChange={(e) => {
                        setCatatanInternal(e.target.value);
                        triggerAutosave();
                      }}
                      placeholder="Catatan tambahan untuk internal (opsional)"
                    />
                  </div>
                </div>
              )}

              {step === 3 && formType === 'perizinan' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  <div className="form-group">
                    <label className="form-label form-label--required">Tindak Lanjut</label>
                    <input
                      type="text"
                      list="list-tindakan-perizinan"
                      className="form-input"
                      value={tindakLanjutPerizinan}
                      disabled={isLocked}
                      onChange={(e) => {
                        setTindakLanjutPerizinan(e.target.value);
                        triggerAutosave();
                      }}
                      placeholder="Pilih atau ketik tindak lanjut layanan..."
                    />
                    <datalist id="list-tindakan-perizinan">
                      {TINDAK_LANJUT_PERIZINAN_OPTIONS.map((opt) => (
                        <option key={opt} value={opt} />
                      ))}
                    </datalist>
                    {validationErrors.tindak_lanjut && (
                      <p className="form-error" style={{ color: 'var(--color-danger-600)', fontSize: 12, marginTop: 4 }}>
                        {validationErrors.tindak_lanjut}
                      </p>
                    )}
                  </div>

                  <div className="form-group">
                    <label className="form-label">Catatan Petugas (Opsional)</label>
                    <textarea
                      className="form-textarea"
                      rows={4}
                      value={catatanPetugas}
                      disabled={isLocked}
                      onChange={(e) => {
                        setCatatanPetugas(e.target.value);
                        triggerAutosave();
                      }}
                      placeholder="Catatan persyaratan atau tindak lanjut tambahan (opsional)..."
                    />
                  </div>
                </div>
              )}
            </form>
          )}
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: 'var(--space-4) var(--space-6)',
            borderTop: '1px solid var(--border-default, #e2e8f0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-secondary, #f8fafc)',
            gap: 'var(--space-3)',
          }}
        >
          <div>
            {step > 1 ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}
              >
                <ChevronLeft size={16} /> Sebelumnya
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  saveDraftNow();
                  onClose();
                }}
              >
                {isLocked ? 'Tutup' : 'Simpan & Tutup'}
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
            {!isLocked && (
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={savingDraft}
                onClick={saveDraftNow}
              >
                <Save size={16} /> {savingDraft ? 'Menyimpan…' : 'Simpan Draf'}
              </button>
            )}

            {step < 3 ? (
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3)}
              >
                Selanjutnya <ChevronRight size={16} />
              </button>
            ) : (
              !isLocked && (
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={finalizing}
                  onClick={handleFinalize}
                  style={{
                    backgroundColor: 'var(--color-success-600, #16a34a)',
                    borderColor: 'var(--color-success-600, #16a34a)',
                  }}
                >
                  <CheckCircle2 size={16} /> {finalizing ? 'Menyelesaikan…' : 'Selesaikan Pelayanan'}
                </button>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
