'use client';

// Menyelesaikan tiket HASIL ESKALASI Front Office pada layanan TANPA form pendataan (mis. BPJS, Bank Lampung).
// RPC layanan_selesai 5 parameter (kontrak FO-ESKALASI §3.2): tiket hasil eskalasi WAJIB topik (milik layanan tiket)
// dan catatan 1-1000. Layanan dengan pendataan (OSS / Non OSS) mengisi topik + catatan di PelayananWizardModal.
// Hanya pemilik tiket yang dapat menyelesaikan (ditegakkan DB: BUKAN_PEMILIK).
import { useId, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { createClient } from '@/lib/supabase/client';
import { mutasiWajibBaris, pesanMutasi } from '@/lib/supabase/mutate';
import { kodeGalatDariError, MAX_CATATAN_LAYANAN, PESAN_GALAT_ANTREAN } from '@/lib/pelayanan';
import FormDialog from './FormDialog';
import TopikCatatanFields, { useTopikLayanan } from './TopikCatatanFields';

export interface TiketSelesaiEskalasi {
  id: string;
  nomor_display: string;
  layanan_id: string;
}

interface Props {
  tiket: TiketSelesaiEskalasi | null;
  onClose: () => void;
  /** Dipanggil setelah berhasil (dan setelah galat yang menandakan tampilan basi) agar daftar dimuat ulang. */
  onSuccess?: () => void | Promise<void>;
}

// Formulir bersih per tiket: pemanggil memasang komponen dengan `key={tiket.id}`.
export default function SelesaiEskalasiModal({ tiket, onClose, onSuccess }: Props) {
  const { toast } = useToast();
  const idDasar = useId();
  const { topik, memuat, galat: galatMuat } = useTopikLayanan(tiket?.layanan_id ?? null, tiket !== null);
  const [topikId, setTopikId] = useState('');
  const [catatan, setCatatan] = useState('');
  const [mengirim, setMengirim] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [galatTopik, setGalatTopik] = useState<string | null>(null);
  const [galatCatatan, setGalatCatatan] = useState<string | null>(null);

  if (!tiket) return null;

  const kirim = async () => {
    const catatanBersih = catatan.trim();
    const gTopik = topikId ? null : PESAN_GALAT_ANTREAN.TOPIK_WAJIB;
    const gCatatan = catatanBersih.length === 0
      ? PESAN_GALAT_ANTREAN.CATATAN_WAJIB
      : catatanBersih.length > MAX_CATATAN_LAYANAN ? PESAN_GALAT_ANTREAN.CATATAN_TERLALU_PANJANG : null;
    setGalatTopik(gTopik);
    setGalatCatatan(gCatatan);
    if (gTopik || gCatatan) return;

    setGalat(null);
    setMengirim(true);
    try {
      const supabase = createClient();
      await mutasiWajibBaris(
        supabase.rpc('layanan_selesai', { p_tiket_id: tiket.id, p_topik_id: topikId, p_catatan: catatanBersih }),
      );
      toast(`Tiket ${tiket.nomor_display} selesai dilayani`, 'success');
      await onSuccess?.();
      onClose();
    } catch (err) {
      const kode = kodeGalatDariError(err);
      if (kode === 'TOPIK_WAJIB' || kode === 'TOPIK_TIDAK_VALID') setGalatTopik(PESAN_GALAT_ANTREAN[kode]);
      else if (kode === 'CATATAN_WAJIB' || kode === 'CATATAN_TERLALU_PANJANG') setGalatCatatan(PESAN_GALAT_ANTREAN[kode]);
      else setGalat(kode ? PESAN_GALAT_ANTREAN[kode] : `Gagal menyelesaikan tiket. ${pesanMutasi(err)}`);
      // Status/pemilik tiket berubah di tempat lain: segarkan daftar di belakang dialog.
      if (kode === 'INVALID_STATUS' || kode === 'NOT_FOUND' || kode === 'BUKAN_PEMILIK') await onSuccess?.();
    } finally {
      setMengirim(false);
    }
  };

  return (
    <FormDialog
      judul={<><CheckCircle2 size={18} aria-hidden="true" /> Selesaikan tiket {tiket.nomor_display}</>}
      deskripsi="Tiket ini berasal dari eskalasi Front Office. Pilih topik penanganan dan tulis catatan hasil layanan sebelum menyelesaikan."
      labelKirim="Selesaikan"
      mengirim={mengirim}
      kirimNonaktif={memuat}
      galat={galat}
      onClose={onClose}
      onSubmit={kirim}
    >
      {() => (
        <TopikCatatanFields
          idDasar={idDasar}
          topik={topik}
          memuatTopik={memuat}
          galatMuat={galatMuat}
          topikId={topikId}
          onTopikId={(v) => { setTopikId(v); setGalatTopik(null); setGalat(null); }}
          topikWajib
          catatan={catatan}
          onCatatan={(v) => { setCatatan(v); setGalatCatatan(null); setGalat(null); }}
          catatanWajib
          rows={4}
          placeholderCatatan="Ringkas apa yang dilakukan / hasil layanan"
          galatTopik={galatTopik}
          galatCatatan={galatCatatan}
          disabled={mengirim}
        />
      )}
    </FormDialog>
  );
}
