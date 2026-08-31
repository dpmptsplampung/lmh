'use client';

import { useState, useEffect } from 'react';
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
const LAYANAN_DPMPTSP = new Set([
  'Layanan Perizinan DPMPTSP Provinsi Lampung',
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
    // Petugas dengan layanan tetap: lewati langkah pilih layanan.
    setStep(fixedLayananId ? 3 : 2);
  };

  const handleLayananSelect = (id: string) => {
    setSelectedLayananId(id);
    setStep(3);
  };

  const handleSubmit = async () => {
    setSaving(true);
    setError('');
    try {
      const supabase = createClient();
      const { error: insertError } = await supabase.from('visit').insert({
        asal: 'walk_in',
        nama: visitorName.trim(),
        kontak_hp: visitorPhone.trim() || null,
        asal_instansi: visitorAsal.trim(),
        keperluan: visitorKeperluan.trim() || null,
        layanan_id: selectedLayananId,
        tujuan: 'loket',
        status: 'menunggu',
        waktu_masuk: new Date().toISOString(),
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
    width: 'min(560px, 92vw)', maxHeight: '88vh', overflowY: 'auto',
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
                        {fixedLayananId ? 'Lanjut Konfirmasi' : 'Lanjut Pilih Layanan'} <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                )}

                {step === 2 && !fixedLayananId && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      Layanan apa yang ingin diakses <strong>{visitorName}</strong> hari ini?
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
                                className={`btn ${selectedLayananId === layanan.id ? 'btn--primary' : 'btn--secondary'}`}
                                onClick={() => handleLayananSelect(layanan.id)}
                                style={{ justifyContent: 'flex-start', gap: 'var(--space-2)' }}
                              >
                                <Building2 size={18} />
                                <span style={{ fontSize: 'var(--text-sm)' }}>{layanan.nama}</span>
                              </button>
                            ))}
                          </div>
                        );
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                            <div>
                              <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: 'var(--space-2)' }}>LAYANAN DPMPTSP</div>
                              {renderGrid(dpmptsp)}
                            </div>
                            <div>
                              <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: 'var(--space-2)' }}>LAYANAN P4 (INSTANSI MITRA)</div>
                              {renderGrid(p4)}
                            </div>
                          </div>
                        );
                      })()
                    )}
                    <div className="form-group">
                      <label className="form-label" htmlFor="ww-reason">Keperluan</label>
                      <input
                        id="ww-reason" type="text" className="form-input"
                        placeholder="Detail keperluan singkat (opsional)..."
                        value={visitorKeperluan} onChange={(e) => setVisitorKeperluan(e.target.value)}
                        autoComplete="off"
                      />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                      <button type="button" className="btn btn--secondary" onClick={() => setStep(1)}>
                        <ChevronLeft size={16} /> Kembali
                      </button>
                    </div>
                  </div>
                )}

                {step === 3 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                      Apakah data kunjungan <strong>{visitorName}</strong> sudah benar?
                    </p>
                    <div style={{ fontSize: 'var(--text-sm)', display: 'grid', gap: 'var(--space-2)' }}>
                      <div><strong>Nama:</strong> {visitorName}</div>
                      {visitorPhone.trim() && <div><strong>HP:</strong> {visitorPhone}</div>}
                      <div><strong>Asal:</strong> {visitorAsal}</div>
                      <div><strong>Layanan:</strong> {selectedLayananName}</div>
                      {visitorKeperluan.trim() && <div><strong>Keperluan:</strong> {visitorKeperluan}</div>}
                    </div>
                    {error && <p className="form-error" role="alert">{error}</p>}
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <button
                        type="button" className="btn btn--secondary"
                        onClick={() => setStep(fixedLayananId ? 1 : 2)}
                      >
                        <ChevronLeft size={16} /> Kembali
                      </button>
                      <button type="button" className="btn btn--primary" onClick={handleSubmit} disabled={saving}>
                        {saving ? <Loader2 size={16} className="animate-pulse" /> : <CheckCircle2 size={16} />} Daftarkan
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
