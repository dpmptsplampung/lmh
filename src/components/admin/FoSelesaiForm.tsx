'use client';

// Form "Selesaikan di FO": topik (daftar topik FO) + catatan singkat wajib -> RPC fo_selesai (kontrak §2.4).
// Tombol dikunci selama request; galat dipetakan ke pesan Indonesia (inline, role="alert"). Galat yang berarti
// tampilan basi / sesi tidak sah diteruskan ke halaman lewat `onGalatSistem` (muat ulang / arahkan ke login).
import { useRef, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  foSelesai,
  kodeGalatFo,
  pesanGalatFo,
  validasiTopikCatatan,
  PESAN_GALAT_FO,
  type HasilSelesaiFo,
  type TopikFo,
} from '@/lib/fo-penanganan';
import FoTopikCatatan from './FoTopikCatatan';
import styles from './fo.module.css';

interface Props {
  penangananId: string;
  namaPengunjung: string;
  topik: TopikFo[];
  onBerhasil: (hasil: HasilSelesaiFo) => void;
  onBatal: () => void;
  onGalatSistem?: (e: unknown) => void;
}

export default function FoSelesaiForm({ penangananId, namaPengunjung, topik, onBerhasil, onBatal, onGalatSistem }: Props) {
  const [topikId, setTopikId] = useState('');
  const [catatan, setCatatan] = useState('');
  const [mengirim, setMengirim] = useState(false);
  const [galatTopik, setGalatTopik] = useState<string | null>(null);
  const [galatCatatan, setGalatCatatan] = useState<string | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const kunciRef = useRef(false);

  const kirim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (kunciRef.current) return;
    setGalat(null);
    setGalatTopik(null);
    setGalatCatatan(null);
    const salah = validasiTopikCatatan(topikId, catatan);
    if (salah) {
      if (!topikId) setGalatTopik(salah);
      else setGalatCatatan(salah);
      return;
    }
    kunciRef.current = true;
    setMengirim(true);
    try {
      const hasil = await foSelesai(createClient(), { penangananId, topikId, catatan });
      onBerhasil(hasil);
    } catch (err) {
      const kode = kodeGalatFo(err);
      if (kode === 'TOPIK_WAJIB' || kode === 'TOPIK_TIDAK_VALID') setGalatTopik(PESAN_GALAT_FO[kode]);
      else if (kode === 'CATATAN_WAJIB' || kode === 'CATATAN_TERLALU_PANJANG') setGalatCatatan(PESAN_GALAT_FO[kode]);
      else setGalat(pesanGalatFo(err, 'Gagal menyelesaikan penanganan.'));
      onGalatSistem?.(err);
    } finally {
      kunciRef.current = false;
      setMengirim(false);
    }
  };

  return (
    <form className={styles.formSelesai} onSubmit={kirim} noValidate aria-label={`Selesaikan penanganan ${namaPengunjung}`}>
      <FoTopikCatatan
        topik={topik}
        topikId={topikId}
        catatan={catatan}
        onTopikChange={(id) => { setTopikId(id); setGalatTopik(null); }}
        onCatatanChange={(t) => { setCatatan(t); setGalatCatatan(null); }}
        disabled={mengirim}
        galatTopik={galatTopik}
        galatCatatan={galatCatatan}
        fokusAwal
      />
      {galat && <p role="alert" className={styles.galat}>{galat}</p>}
      <div className={styles.aksi}>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onBatal} disabled={mengirim}>
          Batal
        </button>
        <button type="submit" className="btn btn--primary btn--sm" disabled={mengirim} aria-busy={mengirim}>
          {mengirim
            ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            : <CheckCircle2 size={14} aria-hidden="true" />}
          {mengirim ? 'Menyimpan…' : 'Selesaikan penanganan'}
        </button>
      </div>
    </form>
  );
}
