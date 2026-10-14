'use client';

// "Kembalikan ke FO": petugas/Admin pemilik tiket HASIL ESKALASI yang sedang dilayani mengembalikan pengunjung ke
// kotak masuk Front Office (RPC layanan_kembalikan, kontrak FO-ESKALASI §3.3). Catatan wajib (1-1000) berisi alasan;
// topik opsional (topik milik layanan tiket). Tiket menjadi `dikembalikan`.
import { useId, useState } from 'react';
import { Undo2 } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { createClient } from '@/lib/supabase/client';
import { mutasiWajibBaris, pesanMutasi } from '@/lib/supabase/mutate';
import { kodeGalatDariError, MAX_CATATAN_LAYANAN, PESAN_GALAT_ANTREAN } from '@/lib/pelayanan';
import FormDialog from './FormDialog';
import TopikCatatanFields, { useTopikLayanan } from './TopikCatatanFields';

export interface TiketKembalikan {
  id: string;
  nomor_display: string;
  layanan_id: string;
}

interface Props {
  tiket: TiketKembalikan | null;
  onClose: () => void;
  onSuccess?: () => void | Promise<void>;
}

export default function KembalikanKeFoModal({ tiket, onClose, onSuccess }: Props) {
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
    const gCatatan = catatanBersih.length === 0
      ? PESAN_GALAT_ANTREAN.CATATAN_WAJIB
      : catatanBersih.length > MAX_CATATAN_LAYANAN ? PESAN_GALAT_ANTREAN.CATATAN_TERLALU_PANJANG : null;
    setGalatCatatan(gCatatan);
    if (gCatatan) return;

    setGalat(null);
    setMengirim(true);
    try {
      const supabase = createClient();
      await mutasiWajibBaris(
        supabase.rpc('layanan_kembalikan', {
          p_tiket_id: tiket.id,
          p_catatan: catatanBersih,
          p_topik_id: topikId || null,
        }),
      );
      toast(`Tiket ${tiket.nomor_display} dikembalikan ke Front Office`, 'success');
      await onSuccess?.();
      onClose();
    } catch (err) {
      const kode = kodeGalatDariError(err);
      if (kode === 'TOPIK_TIDAK_VALID') setGalatTopik(PESAN_GALAT_ANTREAN.TOPIK_TIDAK_VALID);
      else if (kode === 'CATATAN_WAJIB' || kode === 'CATATAN_TERLALU_PANJANG') setGalatCatatan(PESAN_GALAT_ANTREAN[kode]);
      else setGalat(kode ? PESAN_GALAT_ANTREAN[kode] : `Gagal mengembalikan tiket. ${pesanMutasi(err)}`);
      if (kode === 'INVALID_STATUS' || kode === 'NOT_FOUND' || kode === 'BUKAN_PEMILIK' || kode === 'TIKET_LAMA') {
        await onSuccess?.();
      }
    } finally {
      setMengirim(false);
    }
  };

  return (
    <FormDialog
      judul={<><Undo2 size={18} aria-hidden="true" /> Kembalikan {tiket.nomor_display} ke Front Office</>}
      deskripsi="Pengunjung akan masuk kembali ke kotak masuk Front Office. Tulis alasan pengembalian agar Front Office tahu tindak lanjutnya."
      labelKirim="Kembalikan ke FO"
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
          topikWajib={false}
          catatan={catatan}
          onCatatan={(v) => { setCatatan(v); setGalatCatatan(null); setGalat(null); }}
          catatanWajib
          labelCatatan="Alasan pengembalian"
          rows={4}
          placeholderCatatan="Contoh: kebutuhan pemohon bukan di layanan ini, arahkan ke layanan lain"
          galatTopik={galatTopik}
          galatCatatan={galatCatatan}
          disabled={mengirim}
        />
      )}
    </FormDialog>
  );
}
