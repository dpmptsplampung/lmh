'use client';

// Dialog Eskalasi (FO -> petugas layanan): layanan tujuan (layanan aktif ber-antrean; pra-pilih layanan saran dari
// reservasi), topik + catatan wajib -> RPC fo_eskalasi (kontrak §2.5). Hasil (nomor tiket, petugas_hadir) dikirim
// ke pemanggil lewat `onBerhasil`; dialog ditutup oleh pemanggil. Galat spesifik layanan (tutup/tidak buka/tidak valid)
// ditampilkan inline dan dialog tetap terbuka agar FO bisa memilih layanan lain.
import { useId, useRef, useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  foEskalasi,
  kodeGalatFo,
  pesanGalatFo,
  validasiTopikCatatan,
  PESAN_GALAT_FO,
  type HasilEskalasi,
  type LayananTujuan,
  type TopikFo,
} from '@/lib/fo-penanganan';
import FoDialog from './FoDialog';
import FoTopikCatatan from './FoTopikCatatan';
import styles from './fo.module.css';

interface Props {
  penangananId: string;
  namaPengunjung: string;
  /** Layanan yang dipilih pengunjung saat reservasi = saran tujuan (kunjungan.layanan_saran_id). */
  layananSaranId: string | null;
  layanan: LayananTujuan[];
  topik: TopikFo[];
  onClose: () => void;
  onBerhasil: (hasil: HasilEskalasi) => void;
  /** Galat yang berarti tampilan basi / sesi tidak sah (halaman memuat ulang atau mengarahkan ke login). */
  onGalatSistem?: (e: unknown) => void;
}

export default function FoEskalasiDialog({
  penangananId, namaPengunjung, layananSaranId, layanan, topik, onClose, onBerhasil, onGalatSistem,
}: Props) {
  const saranValid = layananSaranId !== null && layanan.some((l) => l.id === layananSaranId);
  const [layananId, setLayananId] = useState(saranValid ? (layananSaranId as string) : '');
  const [topikId, setTopikId] = useState('');
  const [catatan, setCatatan] = useState('');
  const [mengirim, setMengirim] = useState(false);
  const [galatLayanan, setGalatLayanan] = useState<string | null>(null);
  const [galatTopik, setGalatTopik] = useState<string | null>(null);
  const [galatCatatan, setGalatCatatan] = useState<string | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const kunciRef = useRef(false);
  const idDasar = useId();
  const idLayanan = `${idDasar}-layanan`;
  const idLayananBantuan = `${idDasar}-layanan-bantuan`;
  const idGalatLayanan = `${idDasar}-galat-layanan`;

  const layananSaran = saranValid ? layanan.find((l) => l.id === layananSaranId) : undefined;

  const kirim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (kunciRef.current) return;
    setGalat(null);
    setGalatLayanan(null);
    setGalatTopik(null);
    setGalatCatatan(null);
    if (!layananId) {
      setGalatLayanan('Pilih layanan tujuan eskalasi.');
      return;
    }
    const salah = validasiTopikCatatan(topikId, catatan);
    if (salah) {
      if (!topikId) setGalatTopik(salah);
      else setGalatCatatan(salah);
      return;
    }
    kunciRef.current = true;
    setMengirim(true);
    try {
      const hasil = await foEskalasi(createClient(), { penangananId, layananId, topikId, catatan });
      onBerhasil(hasil);
    } catch (err) {
      const kode = kodeGalatFo(err);
      if (kode === 'LAYANAN_TIDAK_VALID' || kode === 'LAYANAN_TIDAK_BUKA' || kode === 'LAYANAN_TUTUP') {
        setGalatLayanan(PESAN_GALAT_FO[kode]);
      } else if (kode === 'TOPIK_WAJIB' || kode === 'TOPIK_TIDAK_VALID') {
        setGalatTopik(PESAN_GALAT_FO[kode]);
      } else if (kode === 'CATATAN_WAJIB' || kode === 'CATATAN_TERLALU_PANJANG') {
        setGalatCatatan(PESAN_GALAT_FO[kode]);
      } else {
        setGalat(pesanGalatFo(err, 'Gagal mengeskalasi penanganan.'));
      }
      onGalatSistem?.(err);
    } finally {
      kunciRef.current = false;
      setMengirim(false);
    }
  };

  return (
    <FoDialog
      judul={`Eskalasi ${namaPengunjung}`}
      deskripsi="Pengunjung akan diteruskan ke petugas layanan dan menerima nomor antrean baru."
      onClose={onClose}
      dikunci={mengirim}
      onSubmit={kirim}
      footer={
        <>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} disabled={mengirim}>
            Batal
          </button>
          <button type="submit" className="btn btn--primary btn--sm" disabled={mengirim || layanan.length === 0} aria-busy={mengirim}>
            {mengirim
              ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              : <ArrowRight size={14} aria-hidden="true" />}
            {mengirim ? 'Mengeskalasi…' : 'Eskalasi & terbitkan nomor'}
          </button>
        </>
      }
    >
      <div className={styles.field}>
        <label htmlFor={idLayanan} className="form-label form-label--required">Layanan tujuan</label>
        <select
          id={idLayanan}
          className="form-select"
          value={layananId}
          disabled={mengirim}
          required
          aria-required="true"
          aria-invalid={galatLayanan ? true : undefined}
          aria-describedby={[layananSaran ? idLayananBantuan : null, galatLayanan ? idGalatLayanan : null]
            .filter(Boolean).join(' ') || undefined}
          data-autofocus=""
          onChange={(e) => { setLayananId(e.target.value); setGalatLayanan(null); }}
        >
          <option value="">Pilih layanan…</option>
          {layanan.map((l) => (
            <option key={l.id} value={l.id}>
              {l.nama}{l.prefiks_antrean ? ` (${l.prefiks_antrean})` : ''}
            </option>
          ))}
        </select>
        {layananSaran && (
          <span id={idLayananBantuan} className={styles.bantuan}>
            Disarankan dari reservasi pengunjung: {layananSaran.nama}.
          </span>
        )}
        {layanan.length === 0 && (
          <span className={styles.galat}>Tidak ada layanan aktif ber-antrean yang dapat dipilih.</span>
        )}
        {galatLayanan && <p id={idGalatLayanan} role="alert" className={styles.galat}>{galatLayanan}</p>}
      </div>

      <FoTopikCatatan
        topik={topik}
        topikId={topikId}
        catatan={catatan}
        onTopikChange={(id) => { setTopikId(id); setGalatTopik(null); }}
        onCatatanChange={(t) => { setCatatan(t); setGalatCatatan(null); }}
        disabled={mengirim}
        galatTopik={galatTopik}
        galatCatatan={galatCatatan}
      />

      {galat && <p role="alert" className={styles.galat}>{galat}</p>}
    </FoDialog>
  );
}
