'use client';

import { useState, useEffect, useRef } from 'react';
import {
  UserPlus,
  X,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Building2,
  Loader2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface LayananItem {
  id: string;
  nama: string;
}

// Pengelompokan layanan untuk wizard walk-in (berdasarkan nama di tabel layanan)
// Batas panjang keperluan
const KEPERLUAN_MAX = 500;

const LAYANAN_DPMPTSP = new Set([
  'Non OSS (SiCantik Lampung)',
  'Helpdesk OSS',
  'Investment Gallery',
  'Matchmaking UMKM',
]);

interface WalkinWizardProps {
  // Bila diset (petugas), pilihan layanan dikunci ke layanan ini dan langkah
  // pilih-layanan dilewati. Bila null (admin), petugas memilih bebas.
  fixedLayananId?: string | null;
  onSuccess?: () => void;
  triggerLabel?: string;
  triggerClassName?: string;
}

export default function WalkinWizard({
  fixedLayananId = null,
  onSuccess,
  triggerLabel = '+ Registrasi Kunjungan Walk-in (Cepat)',
  triggerClassName,
}: WalkinWizardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [visitorName, setVisitorName] = useState('');
  const [visitorPhone, setVisitorPhone] = useState('');
  const [visitorAsal, setVisitorAsal] = useState('');
  const [visitorKeperluan, setVisitorKeperluan] = useState('');
  const [selectedLayananId, setSelectedLayananId] = useState('');
  const [layananList, setLayananList] = useState<LayananItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  // Guard sinkron: klik ganda sebelum re-render tidak boleh mengirim 2x.
  const submittingRef = useRef(false);

  useEffect(() => {
    async function loadLayanan() {
      const supabase = createClient();
      const { data } = await supabase.from('layanan').select('id, nama').order('nama');
      setLayananList((data ?? []) as LayananItem[]);
    }
    loadLayanan();
  }, []);

  const openWizard = () => {
    setError('');
    setSuccess(false);
    setStep(1);
    setSelectedLayananId(fixedLayananId ?? '');
    setIsOpen(true);
  };

  const closeWizard = () => {
    setIsOpen(false);
    setStep(1);
    setVisitorName('');
    setVisitorPhone('');
    setVisitorAsal('');
    setVisitorKeperluan('');
    setSelectedLayananId('');
    setSuccess(false);
    setError('');
  };

  const handleNextStep = () => {
    if (!visitorName.trim()) {
      setError('Nama pengunjung wajib diisi');
      return;
    }
    if (visitorPhone.trim() && !/^(\+?62|0)\d{8,14}$/.test(visitorPhone.trim().replace(/[\s-]/g, ''))) {
      setError('Nomor handphone tidak valid. Contoh: 0812xxxxxxx');
      return;
    }
    if (!visitorAsal.trim()) {
      setError('Asal instansi / alamat wajib diisi');
      return;
    }
    setError('');
    setStep(2);
  };

  // Klik layanan hanya MEMILIH; pengiriman hanya lewat tombol Simpan.
  const handleLayananSelect = (id: string) => {
    setSelectedLayananId(id);
    document.getElementById('ww-reason')?.focus();
  };

  const keperluanTrim = visitorKeperluan.trim();
  const canSave = !!selectedLayananId && keperluanTrim.length > 0 && !saving;

  const handleSubmit = async () => {
    if (!canSave || submittingRef.current) return;
    submittingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const supabase = createClient();
      // Idempotensi: klik ganda tombol daftar tidak menghasilkan 2 tiket.
      const clientRequestId = crypto.randomUUID();
      const { error: insertError } = await supabase.from('visit').insert({
        asal: 'walk_in',
        nama: visitorName.trim(),
        kontak_hp: visitorPhone.trim() || null,
        asal_instansi: visitorAsal.trim(),
        keperluan: keperluanTrim,
        layanan_id: selectedLayananId,
        tujuan: 'loket',
        status: 'menunggu',
        waktu_masuk: new Date().toISOString(),
        client_request_id: clientRequestId,
      });
      if (insertError) throw insertError;
      setSuccess(true);
      onSuccess?.();
    } catch (e) {
      const msg = e instanceof Error && e.message.includes('tidak beroperasi')
        ? 'Layanan tidak beroperasi hari ini (libur/di luar jadwal).'
        : 'Gagal menyimpan kunjungan walk-in. Silakan coba lagi.';
      setError(msg);
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  };

  const selectedLayananName =
    layananList.find((l) => l.id === selectedLayananId)?.nama || 'Loket Layanan';

  // ponytail: gaya wizard disalin dari dashboard admin (inline + CSS global)
  const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  };
  const cardStyle: React.CSSProperties = {
    background: '#ffffff', borderRadius: 'var(--radius-2xl, 16px)',
    width: 'min(560px, 92vw)', maxHeight: 'calc(100dvh - 2rem)', overflowY: 'auto',
    padding: 'var(--space-6, 24px)',
    boxShadow: '0 10px 40px rgba(15, 23, 42, 0.12), 0 2px 6px rgba(15, 23, 42, 0.04)',
    border: '1px solid var(--border-default, #e2e8f0)',
  };

  return (
    <>
      <button type="button" className={triggerClassName ?? 'btn btn--primary'} onClick={openWizard}>
        <UserPlus size={18} /> {triggerLabel}
      </button>

      {isOpen && (
        <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Registrasi Walk-in">
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontWeight: 700 }}>
                <UserPlus size={18} /> Registrasi Walk-in
              </div>
              {!success && (
                <button type="button" className="btn btn--ghost btn--sm" onClick={closeWizard} aria-label="Tutup">
                  <X size={18} />
                </button>
              )}
            </div>

            {success ? (
              <div style={{ textAlign: 'center', padding: 'var(--space-4)' }}>
                <CheckCircle2 size={48} style={{ color: 'var(--color-success-600)', margin: '0 auto var(--space-4)' }} />
                <h3 style={{ fontWeight: 700, marginBottom: 'var(--space-2)' }}>Registrasi Kunjungan Berhasil!</h3>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-5)', lineHeight: 1.6 }}>
                  <strong>{visitorName}</strong> dari <strong>{visitorAsal}</strong> terdaftar ke loket <strong>{selectedLayananName}</strong>.
                </p>
                <button className="btn btn--primary" onClick={closeWizard} style={{ width: '100%' }}>
                  Tutup & Selesai
                </button>
              </div>
            ) : (
              <>
                {step === 1 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                    <div className="form-group">
                      <label className="form-label form-label--required" htmlFor="ww-name">Nama Lengkap</label>
                      <input
                        id="ww-name" type="text" className="form-input"
                        placeholder="Contoh: Budi Santoso"
                        value={visitorName} onChange={(e) => setVisitorName(e.target.value)}
                        autoComplete="off" required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="ww-phone">Nomor Handphone</label>
                      <input
                        id="ww-phone" type="tel" className="form-input"
                        placeholder="Contoh: 0812xxxxxxx (opsional)"
                        value={visitorPhone} onChange={(e) => setVisitorPhone(e.target.value)}
                        autoComplete="off"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label form-label--required" htmlFor="ww-asal">Asal Instansi / Alamat</label>
                      <input
                        id="ww-asal" type="text" className="form-input"
                        placeholder="Contoh: PT Lampung Berjaya / Kedaton"
                        value={visitorAsal} onChange={(e) => setVisitorAsal(e.target.value)}
                        autoComplete="off" required
                      />
                    </div>
                    {error && <p className="form-error" role="alert">{error}</p>}
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button type="button" className="btn btn--primary" onClick={handleNextStep}>
                        {fixedLayananId ? 'Lanjut Isi Keperluan' : 'Lanjut Pilih Layanan'} <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                    {fixedLayananId ? (
                      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        <strong>{visitorName}</strong> akan didaftarkan ke loket <strong>{selectedLayananName}</strong>.
                      </p>
                    ) : (
                      <>
                        <p id="ww-layanan-label" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                          Layanan apa yang ingin diakses <strong>{visitorName}</strong> hari ini? (pilih satu)
                        </p>
                        {layananList.length === 0 ? (
                          <p className="form-error" role="alert">Gagal memuat daftar layanan</p>
                        ) : (
                          (() => {
                            const dpmptsp = layananList.filter((l) => LAYANAN_DPMPTSP.has(l.nama));
                            const p4 = layananList.filter((l) => !LAYANAN_DPMPTSP.has(l.nama));
                            const renderGrid = (items: LayananItem[]) => (
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 'var(--space-2)' }}>
                                {items.map((layanan) => (
                                  <button
                                    type="button" key={layanan.id}
                                    aria-pressed={selectedLayananId === layanan.id}
                                    className={`btn ${selectedLayananId === layanan.id ? 'btn--primary' : 'btn--secondary'}`}
                                    onClick={() => handleLayananSelect(layanan.id)}
                                    style={{ justifyContent: 'flex-start', gap: 'var(--space-2)', textAlign: 'left', height: 'auto', minHeight: 44, whiteSpace: 'normal', overflowWrap: 'anywhere' }}
                                  >
                                    <Building2 size={18} style={{ flexShrink: 0 }} />
                                    <span style={{ fontSize: 'var(--text-sm)' }}>{layanan.nama}</span>
                                  </button>
                                ))}
                              </div>
                            );
                            return (
                              <div role="group" aria-labelledby="ww-layanan-label" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                                {dpmptsp.length > 0 && (
                                  <div>
                                    <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: 'var(--space-2)' }}>LAYANAN DPMPTSP</div>
                                    {renderGrid(dpmptsp)}
                                  </div>
                                )}
                                {p4.length > 0 && (
                                  <div>
                                    <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: 'var(--space-2)' }}>LAYANAN P4 (INSTANSI MITRA)</div>
                                    {renderGrid(p4)}
                                  </div>
                                )}
                              </div>
                            );
                          })()
                        )}
                      </>
                    )}
                    <div className="form-group">
                      <label className="form-label form-label--required" htmlFor="ww-reason">Keperluan</label>
                      <textarea
                        id="ww-reason" className="form-textarea"
                        rows={3} maxLength={KEPERLUAN_MAX} required
                        placeholder="Tuliskan keperluan kunjungan secara singkat..."
                        aria-describedby="ww-reason-hint"
                        value={visitorKeperluan} onChange={(e) => setVisitorKeperluan(e.target.value)}
                        style={{ minHeight: 80 }}
                      />
                      <div id="ww-reason-hint" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 'var(--space-1)', display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                        <span>
                          {!selectedLayananId
                            ? 'Pilih layanan dan isi keperluan untuk menyimpan.'
                            : keperluanTrim.length === 0
                              ? 'Keperluan wajib diisi.'
                              : ' '}
                        </span>
                        <span>{visitorKeperluan.length}/{KEPERLUAN_MAX}</span>
                      </div>
                    </div>
                    {error && <p className="form-error" role="alert">{error}</p>}
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                      <button type="button" className="btn btn--secondary" onClick={() => setStep(1)} disabled={saving}>
                        <ChevronLeft size={16} /> Kembali
                      </button>
                      <button type="button" className="btn btn--primary" onClick={handleSubmit} disabled={!canSave}>
                        {saving ? <Loader2 size={16} className="animate-pulse" /> : <CheckCircle2 size={16} />} Simpan
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
