'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
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
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import styles from './scan.module.css';

interface ReservasiResult {
  id: string;
  tujuan: string;
  nama_yang_ditemui: string | null;
  tanggal_rencana: string;
  jam_rencana: string | null;
  keperluan: string | null;
  status: string;
  qr_token: string;
  pengunjung: {
    nama: string;
    email: string | null;
    foto_url: string | null;
  };
  layanan: {
    nama: string;
  } | null;
}

type ScanState = 'scanning' | 'found' | 'not_found' | 'processed' | 'error';

export default function AdminScanPage() {
  const [scanState, setScanState] = useState<ScanState>('scanning');
  const [result, setResult] = useState<ReservasiResult | null>(null);
  const [processing, setProcessing] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [diarahkanKe, setDiarahkanKe] = useState('');
  const scannerRef = useRef<HTMLDivElement>(null);
  const html5QrRef = useRef<unknown>(null);

  const lookupToken = useCallback(async (token: string) => {
    const supabase = createClient();

    const { data, error } = await supabase
      .from('reservasi')
      .select(`
        id, tujuan, nama_yang_ditemui, tanggal_rencana, jam_rencana,
        keperluan, status, qr_token,
        pengunjung(nama, email, foto_url),
        layanan(nama)
      `)
      .eq('qr_token', token)
      .single();

    if (error || !data) {
      setScanState('not_found');
      setResult(null);
      return;
    }

    // Normalize joined data (Supabase returns object or array depending on FK cardinality)
    const normalized: ReservasiResult = {
      ...data,
      pengunjung: Array.isArray(data.pengunjung) ? data.pengunjung[0] : data.pengunjung,
      layanan: Array.isArray(data.layanan) ? data.layanan[0] : data.layanan,
    };

    setResult(normalized);
    setScanState('found');
  }, []);

  // Init scanner
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let scanner: any = null;

    const initScanner = async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');

        if (!scannerRef.current) return;

        const scannerId = 'qr-scanner-element';

        // Ensure element exists
        let scannerEl = document.getElementById(scannerId);
        if (!scannerEl && scannerRef.current) {
          scannerEl = document.createElement('div');
          scannerEl.id = scannerId;
          scannerRef.current.appendChild(scannerEl);
        }

        const html5QrCode = new Html5Qrcode(scannerId);
        html5QrRef.current = html5QrCode;

        await html5QrCode.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0,
          },
          async (decodedText: string) => {
            // Pause scanner saat memproses
            try {
              html5QrCode.pause(true);
            } catch { /* ignore */ }
            await lookupToken(decodedText);
          },
          () => { /* ignore scan failures */ }
        );

        scanner = html5QrCode;
      } catch (err) {
        console.error('Scanner init error:', err);
      }
    };

    initScanner();

    return () => {
      if (scanner) {
        try { scanner.clear(); } catch { /* ignore */ }
      }
    };
  }, [lookupToken]);

  const handleProcess = async (action: 'hadir' | 'selesai') => {
    if (!result) return;
    setProcessing(true);

    const supabase = createClient();

    const updateData: Record<string, unknown> = {
      status: action === 'hadir' ? 'hadir' : 'selesai',
      updated_at: new Date().toISOString(),
    };

    if (action === 'hadir') {
      updateData.waktu_scan = new Date().toISOString();
      if (diarahkanKe.trim()) {
        updateData.diarahkan_ke = diarahkanKe.trim();
      } else if (result.tujuan === 'loket' && result.layanan) {
        updateData.diarahkan_ke = `Loket ${result.layanan.nama}`;
      } else if (result.tujuan === 'bertemu_seseorang') {
        updateData.diarahkan_ke = `Bertemu ${result.nama_yang_ditemui}`;
      }
    }

    const { error } = await supabase
      .from('reservasi')
      .update(updateData)
      .eq('id', result.id);

    setProcessing(false);

    if (error) {
      console.error('Update error:', error);
      return;
    }

    setScanState('processed');
  };

  const handleReset = async () => {
    setScanState('scanning');
    setResult(null);
    setDiarahkanKe('');
    setManualToken('');

    // Resume scanner
    try {
      const scanner = html5QrRef.current as { resume?: () => void } | null;
      if (scanner?.resume) {
        scanner.resume();
      }
    } catch { /* ignore */ }
  };

  const handleManualLookup = async () => {
    if (!manualToken.trim()) return;
    await lookupToken(manualToken.trim());
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  return (
    <>
      <PageHeader
        title="Scan QR Pengunjung"
        description="Scan barcode pengunjung yang sudah booking online"
      />

      <div className={styles.scanPage}>
        <div className={styles.scanLayout}>
          {/* Scanner */}
          <div className={styles.scannerCard}>
            <div className={styles.scannerHeader}>
              <Camera size={18} className={styles.scannerHeaderIcon} />
              Kamera Scanner
            </div>
            <div className={styles.scannerBody}>
              <div className={styles.scannerPreview} ref={scannerRef} />

              <div className={`${styles.scannerStatus} ${
                scanState === 'scanning' ? styles.scannerStatusActive : styles.scannerStatusIdle
              }`}>
                {scanState === 'scanning' ? (
                  <><div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-success-500)', animation: 'pulse 1.5s infinite' }} /> Menunggu scan...</>
                ) : (
                  <><QrCode size={14} /> Scanner dijeda</>
                )}
              </div>

              {/* Manual input */}
              <div className={styles.manualInput}>
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-2)' }}>
                  Atau masukkan token secara manual:
                </p>
                <div className={styles.manualInputRow}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Paste token QR..."
                    value={manualToken}
                    onChange={(e) => setManualToken(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleManualLookup(); }}
                    style={{ fontSize: 'var(--text-sm)' }}
                  />
                  <button className="btn btn--primary btn--sm" onClick={handleManualLookup}>
                    <Search size={16} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Result */}
          <div className={styles.resultCard}>
            <div className={styles.resultHeader}>
              Informasi Pengunjung
            </div>
            <div className={styles.resultBody}>
              {scanState === 'scanning' && (
                <div className={styles.resultEmpty}>
                  <QrCode size={48} className={styles.resultEmptyIcon} />
                  <h3 style={{ fontWeight: 600, marginBottom: 'var(--space-2)' }}>Menunggu Scan</h3>
                  <p style={{ fontSize: 'var(--text-sm)' }}>
                    Arahkan kamera ke QR code pengunjung
                  </p>
                </div>
              )}

              {scanState === 'not_found' && (
                <div className={styles.notFound}>
                  <XCircle size={48} className={styles.notFoundIcon} />
                  <h3 style={{ fontWeight: 600, marginBottom: 'var(--space-2)' }}>Tidak Ditemukan</h3>
                  <p style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)' }}>
                    QR code tidak terdaftar atau reservasi sudah kadaluarsa.
                  </p>
                  <button className="btn btn--secondary btn--sm" onClick={handleReset}>
                    <RotateCcw size={14} />
                    Scan Ulang
                  </button>
                </div>
              )}

              {scanState === 'found' && result && (
                <div className={styles.visitorInfo}>
                  {/* Visitor Header */}
                  <div className={styles.visitorHeader}>
                    {result.pengunjung.foto_url ? (
                      <img src={result.pengunjung.foto_url} alt="" className={styles.visitorAvatar} referrerPolicy="no-referrer" />
                    ) : (
                      <div className={styles.visitorAvatarFallback}>
                        {result.pengunjung.nama.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <div className={styles.visitorName}>{result.pengunjung.nama}</div>
                      <div className={styles.visitorEmail}>{result.pengunjung.email}</div>
                    </div>
                  </div>

                  {/* Details */}
                  <div className={styles.detailGrid}>
                    <div className={styles.detailItem}>
                      <div className={styles.detailIcon}>
                        {result.tujuan === 'loket' ? <MapPin size={18} /> : <User size={18} />}
                      </div>
                      <div>
                        <div className={styles.detailLabel}>Tujuan</div>
                        <div className={styles.detailValue}>
                          {result.tujuan === 'loket'
                            ? result.layanan?.nama || 'Loket Layanan'
                            : `Bertemu: ${result.nama_yang_ditemui}`}
                        </div>
                      </div>
                    </div>

                    <div className={styles.detailItem}>
                      <div className={styles.detailIcon}><Calendar size={18} /></div>
                      <div>
                        <div className={styles.detailLabel}>Tanggal</div>
                        <div className={styles.detailValue}>{formatDate(result.tanggal_rencana)}</div>
                      </div>
                    </div>

                    {result.jam_rencana && (
                      <div className={styles.detailItem}>
                        <div className={styles.detailIcon}><Clock size={18} /></div>
                        <div>
                          <div className={styles.detailLabel}>Jam</div>
                          <div className={styles.detailValue}>{result.jam_rencana.substring(0, 5)} WIB</div>
                        </div>
                      </div>
                    )}

                    {result.keperluan && (
                      <div className={styles.detailItem}>
                        <div className={styles.detailIcon}><Search size={18} /></div>
                        <div>
                          <div className={styles.detailLabel}>Keperluan</div>
                          <div className={styles.detailValue}>{result.keperluan}</div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className={styles.actionButtons}>
                    {result.tujuan === 'loket' && result.layanan && (
                      <button
                        className="btn btn--primary btn--lg"
                        style={{ width: '100%' }}
                        onClick={() => handleProcess('hadir')}
                        disabled={processing}
                      >
                        {processing ? (
                          <><Loader2 size={18} className="animate-pulse" /> Memproses...</>
                        ) : (
                          <><ArrowRight size={18} /> Arahkan ke Loket {result.layanan.nama}</>
                        )}
                      </button>
                    )}

                    {result.tujuan === 'bertemu_seseorang' && (
                      <>
                        <div className={styles.actionInput}>
                          <input
                            type="text"
                            className="form-input"
                            placeholder={`Arahkan ke... (default: Bertemu ${result.nama_yang_ditemui})`}
                            value={diarahkanKe}
                            onChange={(e) => setDiarahkanKe(e.target.value)}
                          />
                        </div>
                        <button
                          className="btn btn--primary btn--lg"
                          style={{ width: '100%' }}
                          onClick={() => handleProcess('hadir')}
                          disabled={processing}
                        >
                          {processing ? (
                            <><Loader2 size={18} className="animate-pulse" /> Memproses...</>
                          ) : (
                            <><ArrowRight size={18} /> Proses Kedatangan</>
                          )}
                        </button>
                      </>
                    )}

                    <button className="btn btn--ghost btn--sm" onClick={handleReset}>
                      <RotateCcw size={14} />
                      Scan Pengunjung Lain
                    </button>
                  </div>
                </div>
              )}

              {scanState === 'processed' && (
                <div className={styles.scanSuccess}>
                  <div className={styles.scanSuccessIcon}>
                    <CheckCircle2 size={32} />
                  </div>
                  <h3 style={{ fontWeight: 700, fontSize: 'var(--text-lg)', marginBottom: 'var(--space-2)' }}>
                    Berhasil Diproses! ✓
                  </h3>
                  <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-6)' }}>
                    Pengunjung telah dicatat hadir dan diarahkan.
                  </p>
                  <button className="btn btn--primary btn--lg" onClick={handleReset}>
                    <QrCode size={18} />
                    Scan Pengunjung Berikutnya
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
