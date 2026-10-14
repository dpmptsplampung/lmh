'use client';

// Jalur darurat Admin: ambil alih tiket yang sedang dilayani orang lain (pemilik pergi / tidak aktif).
// RPC admin_ambil_alih (migrasi 202610140002): hanya Admin dengan sesi sah, alasan wajib (minimal 5 karakter),
// tercatat di audit_log (pemilik lama, pemilik baru, alasan). Status tiket TIDAK berubah; setelah ambil alih,
// Admin menjadi pemilik dan dapat mengisi pendataan lalu menyelesaikan tiket.
import { useEffect, useId, useState } from 'react';
import { X, Loader2, UserCog } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { createClient } from '@/lib/supabase/client';
import { mutasiWajibBaris, pesanMutasi } from '@/lib/supabase/mutate';
import { kodeGalatDariError, MIN_ALASAN_AMBIL_ALIH, PESAN_GALAT_ANTREAN } from '@/lib/pelayanan';

export interface TiketAmbilAlih {
  id: string;
  nomor_display: string;
  /** Nama pemilik saat ini bila diketahui; null = tidak tercatat / tidak terbaca. */
  pemilik_nama: string | null;
}

interface Props {
  tiket: TiketAmbilAlih | null;
  onClose: () => void;
  /** Dipanggil setelah berhasil (dan setelah galat yang menandakan tampilan basi) agar daftar dimuat ulang. */
  onSuccess?: () => void | Promise<void>;
}

export default function AmbilAlihTiketModal({ tiket, onClose, onSuccess }: Props) {
  const { toast } = useToast();
  const [alasan, setAlasan] = useState('');
  const [mengirim, setMengirim] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const idDasar = useId();
  const idJudul = `${idDasar}-judul`;
  const idDesk = `${idDasar}-desk`;
  const idAlasan = `${idDasar}-alasan`;
  const idBantuan = `${idDasar}-bantuan`;
  const idGalat = `${idDasar}-galat`;
  // Formulir bersih per tiket: pemanggil memasang komponen dengan `key={tiket.id}`.
  const terbuka = tiket !== null;

  useEffect(() => {
    if (!terbuka) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !mengirim) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [terbuka, mengirim, onClose]);

  if (!tiket) return null;

  const alasanBersih = alasan.trim();
  const alasanCukup = alasanBersih.length >= MIN_ALASAN_AMBIL_ALIH;

  const kirim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mengirim) return;
    if (!alasanCukup) {
      setGalat(PESAN_GALAT_ANTREAN.ALASAN_WAJIB);
      return;
    }
    setGalat(null);
    setMengirim(true);
    try {
      const supabase = createClient();
      await mutasiWajibBaris(
        supabase.rpc('admin_ambil_alih', { p_tiket_id: tiket.id, p_alasan: alasanBersih }),
      );
      toast(`Tiket ${tiket.nomor_display} kini menjadi tanggung jawab Anda`, 'success');
      await onSuccess?.();
      onClose();
    } catch (err) {
      const kode = kodeGalatDariError(err);
      setGalat(kode ? PESAN_GALAT_ANTREAN[kode] : `Gagal mengambil alih tiket. ${pesanMutasi(err)}`);
      // Status/pemilik tiket berubah di tempat lain: segarkan daftar di belakang dialog.
      if (kode === 'INVALID_STATUS' || kode === 'NOT_FOUND') await onSuccess?.();
    } finally {
      setMengirim(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={idJudul}
      aria-describedby={idDesk}
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.45)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)',
      }}
    >
      <form
        onSubmit={kirim}
        style={{
          background: 'var(--surface-elevated, #ffffff)', borderRadius: 'var(--radius-2xl, 16px)', width: '100%',
          maxWidth: '480px', border: '1px solid var(--border-default, #e2e8f0)', overflow: 'hidden',
        }}
      >
        <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--border-default, #e2e8f0)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
          <div>
            <h2 id={idJudul} style={{ fontSize: 'var(--text-lg)', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <UserCog size={18} aria-hidden="true" /> Ambil alih tiket {tiket.nomor_display}
            </h2>
            <p id={idDesk} style={{ margin: '4px 0 0', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              Tiket ini sedang dilayani {tiket.pemilik_nama ? <strong>{tiket.pemilik_nama}</strong> : 'petugas lain'}.
              Setelah diambil alih, Anda menjadi penanggung jawab dan hanya Anda yang dapat menyelesaikannya.
              Tindakan ini tercatat di riwayat audit beserta alasannya.
            </p>
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} disabled={mengirim} aria-label="Tutup">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div style={{ padding: 'var(--space-5) var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <label htmlFor={idAlasan} className="form-label form-label--required">
            Alasan ambil alih
          </label>
          <textarea
            id={idAlasan}
            className="form-textarea"
            rows={3}
            value={alasan}
            autoFocus
            required
            minLength={MIN_ALASAN_AMBIL_ALIH}
            maxLength={500}
            disabled={mengirim}
            aria-invalid={galat !== null}
            aria-describedby={galat ? `${idBantuan} ${idGalat}` : idBantuan}
            onChange={(e) => {
              setAlasan(e.target.value);
              if (galat) setGalat(null);
            }}
            placeholder="Contoh: petugas pulang sakit, pemohon masih menunggu di loket"
          />
          <small id={idBantuan} style={{ color: 'var(--text-tertiary)' }}>
            Minimal {MIN_ALASAN_AMBIL_ALIH} karakter.
          </small>
          {galat && (
            <p id={idGalat} role="alert" style={{ color: 'var(--color-danger-600)', fontSize: 'var(--text-sm)', margin: 0 }}>
              {galat}
            </p>
          )}
        </div>

        <div style={{ padding: 'var(--space-4) var(--space-6)', borderTop: '1px solid var(--border-default, #e2e8f0)', display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} disabled={mengirim}>
            Batal
          </button>
          <button type="submit" className="btn btn--primary btn--sm" disabled={mengirim} aria-busy={mengirim}>
            {mengirim ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
            {mengirim ? 'Memproses…' : 'Ambil alih'}
          </button>
        </div>
      </form>
    </div>
  );
}
