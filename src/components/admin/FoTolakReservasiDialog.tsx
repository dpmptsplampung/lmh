'use client';

// Dialog "Tolak pengunjung" pada scan QR: alasan wajib (5-500 karakter) -> RPC fo_tolak_reservasi (kontrak §2.3).
// Pengganti window.confirm: dialog aksesibel (Escape, focus trap, fokus kembali ke tombol pemicu) dengan label terhubung.
import { useId, useRef, useState } from 'react';
import { Loader2, XCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  foTolakReservasi,
  kodeGalatFo,
  pesanGalatFo,
  MAKS_ALASAN_TOLAK,
  MIN_ALASAN_TOLAK,
  PESAN_GALAT_FO,
  type HasilTolakReservasi,
} from '@/lib/fo-penanganan';
import FoDialog from './FoDialog';
import styles from './fo.module.css';

interface Props {
  qrToken: string;
  namaPengunjung: string;
  onClose: () => void;
  onBerhasil: (hasil: HasilTolakReservasi) => void;
  onGalatSistem?: (e: unknown) => void;
}

export default function FoTolakReservasiDialog({ qrToken, namaPengunjung, onClose, onBerhasil, onGalatSistem }: Props) {
  const [alasan, setAlasan] = useState('');
  const [mengirim, setMengirim] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const kunciRef = useRef(false);
  const idDasar = useId();
  const idAlasan = `${idDasar}-alasan`;
  const idBantuan = `${idDasar}-bantuan`;
  const idGalat = `${idDasar}-galat`;

  const kirim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (kunciRef.current) return;
    const bersih = alasan.trim();
    if (bersih.length < MIN_ALASAN_TOLAK) {
      setGalat(PESAN_GALAT_FO.ALASAN_WAJIB);
      return;
    }
    setGalat(null);
    kunciRef.current = true;
    setMengirim(true);
    try {
      const hasil = await foTolakReservasi(createClient(), { qrToken, alasan: bersih });
      onBerhasil(hasil);
    } catch (err) {
      setGalat(kodeGalatFo(err) === 'ALASAN_WAJIB' ? PESAN_GALAT_FO.ALASAN_WAJIB : pesanGalatFo(err, 'Gagal menolak pengunjung.'));
      onGalatSistem?.(err);
    } finally {
      kunciRef.current = false;
      setMengirim(false);
    }
  };

  return (
    <FoDialog
      judul={`Tolak ${namaPengunjung}`}
      deskripsi="Reservasi akan dibatalkan dan QR tidak dapat dipakai lagi. Tindakan ini tercatat beserta alasannya."
      onClose={onClose}
      dikunci={mengirim}
      onSubmit={kirim}
      footer={
        <>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} disabled={mengirim}>
            Batal
          </button>
          <button type="submit" className="btn btn--danger btn--sm" disabled={mengirim} aria-busy={mengirim}>
            {mengirim ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <XCircle size={14} aria-hidden="true" />}
            {mengirim ? 'Memproses…' : 'Tolak pengunjung'}
          </button>
        </>
      }
    >
      <div className={styles.field}>
        <label htmlFor={idAlasan} className="form-label form-label--required">Alasan penolakan</label>
        <textarea
          id={idAlasan}
          className="form-textarea"
          rows={3}
          value={alasan}
          maxLength={MAKS_ALASAN_TOLAK}
          disabled={mengirim}
          required
          aria-required="true"
          aria-invalid={galat ? true : undefined}
          aria-describedby={galat ? `${idBantuan} ${idGalat}` : idBantuan}
          data-autofocus=""
          placeholder="Contoh: identitas tidak sesuai dengan data reservasi"
          onChange={(e) => { setAlasan(e.target.value); if (galat) setGalat(null); }}
        />
        <span id={idBantuan} className={styles.bantuan}>
          Minimal {MIN_ALASAN_TOLAK} karakter, maksimal {MAKS_ALASAN_TOLAK}.
        </span>
        {galat && <p id={idGalat} role="alert" className={styles.galat}>{galat}</p>}
      </div>
    </FoDialog>
  );
}
