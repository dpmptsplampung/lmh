'use client';

// Admin: "Alihkan" tiket hasil eskalasi (status menunggu/dilayani) ke layanan lain (RPC admin_alihkan, kontrak
// FO-ESKALASI §3.5). Tiket lama menjadi `dialihkan`, tiket baru terbit di layanan tujuan dengan nomor baru, tercatat
// di audit_log. Alasan wajib (5-500 karakter). Mengarahkan ke petugas tertentu belum didukung.
import { useEffect, useId, useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { createClient } from '@/lib/supabase/client';
import { mutasiWajibBaris, pesanMutasi } from '@/lib/supabase/mutate';
import { kodeGalatDariError, MAX_ALASAN_ALIHKAN, MIN_ALASAN_ALIHKAN, PESAN_GALAT_ANTREAN } from '@/lib/pelayanan';
import FormDialog from './FormDialog';

export interface TiketAlihkan {
  id: string;
  nomor_display: string;
  layanan_id: string;
  layanan_nama: string;
}

interface LayananTujuan {
  id: string;
  nama: string;
}

interface HasilAlihkan {
  ok: boolean;
  nomor_display?: string;
  layanan_nama?: string;
  petugas_hadir?: boolean;
}

interface Props {
  tiket: TiketAlihkan | null;
  onClose: () => void;
  onSuccess?: () => void | Promise<void>;
}

export default function AlihkanTiketModal({ tiket, onClose, onSuccess }: Props) {
  const { toast } = useToast();
  const idDasar = useId();
  const idLayanan = `${idDasar}-layanan`;
  const idLayananGalat = `${idDasar}-layanan-galat`;
  const idAlasan = `${idDasar}-alasan`;
  const idAlasanBantuan = `${idDasar}-alasan-bantuan`;
  const idAlasanGalat = `${idDasar}-alasan-galat`;

  const [daftar, setDaftar] = useState<LayananTujuan[]>([]);
  const [memuat, setMemuat] = useState(tiket !== null);
  const [galatMuat, setGalatMuat] = useState<string | null>(null);
  const [tujuan, setTujuan] = useState('');
  const [alasan, setAlasan] = useState('');
  const [mengirim, setMengirim] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [galatTujuan, setGalatTujuan] = useState<string | null>(null);
  const [galatAlasan, setGalatAlasan] = useState<string | null>(null);

  const layananAsalId = tiket?.layanan_id ?? null;
  const terbuka = tiket !== null;
  useEffect(() => {
    if (!terbuka) return;
    let batal = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from('layanan')
          .select('id, nama')
          .eq('aktif', true)
          .eq('punya_antrean', true)
          .order('nama');
        if (batal) return;
        if (error) throw error;
        setDaftar(((data ?? []) as LayananTujuan[]).filter((l) => l.id !== layananAsalId));
      } catch {
        if (!batal) setGalatMuat('Gagal memuat daftar layanan. Tutup dialog lalu coba lagi.');
      } finally {
        if (!batal) setMemuat(false);
      }
    })();
    return () => {
      batal = true;
    };
  }, [terbuka, layananAsalId]);

  if (!tiket) return null;

  const kirim = async () => {
    const alasanBersih = alasan.trim();
    const gTujuan = tujuan ? null : 'Pilih layanan tujuan.';
    const gAlasan = alasanBersih.length < MIN_ALASAN_ALIHKAN
      ? PESAN_GALAT_ANTREAN.ALASAN_WAJIB
      : alasanBersih.length > MAX_ALASAN_ALIHKAN ? `Alasan terlalu panjang (maksimal ${MAX_ALASAN_ALIHKAN} karakter).` : null;
    setGalatTujuan(gTujuan);
    setGalatAlasan(gAlasan);
    if (gTujuan || gAlasan) return;

    setGalat(null);
    setMengirim(true);
    try {
      const supabase = createClient();
      const [hasil] = await mutasiWajibBaris<HasilAlihkan>(
        supabase.rpc('admin_alihkan', { p_tiket_id: tiket.id, p_layanan_tujuan: tujuan, p_alasan: alasanBersih }),
      );
      const nomorBaru = hasil?.nomor_display ? ` (nomor baru ${hasil.nomor_display})` : '';
      const layananBaru = hasil?.layanan_nama ? ` ke ${hasil.layanan_nama}` : '';
      toast(`Tiket ${tiket.nomor_display} dialihkan${layananBaru}${nomorBaru}`, 'success');
      if (hasil?.petugas_hadir === false) {
        toast('Belum ada petugas layanan tujuan yang absen hadir hari ini.', 'info');
      }
      await onSuccess?.();
      onClose();
    } catch (err) {
      const kode = kodeGalatDariError(err);
      if (kode === 'LAYANAN_SAMA' || kode === 'LAYANAN_TIDAK_VALID' || kode === 'LAYANAN_TIDAK_BUKA' || kode === 'LAYANAN_TUTUP') {
        setGalatTujuan(PESAN_GALAT_ANTREAN[kode]);
      }
      else if (kode === 'ALASAN_WAJIB') setGalatAlasan(PESAN_GALAT_ANTREAN.ALASAN_WAJIB);
      else setGalat(kode ? PESAN_GALAT_ANTREAN[kode] : `Gagal mengalihkan tiket. ${pesanMutasi(err)}`);
      if (kode === 'INVALID_STATUS' || kode === 'NOT_FOUND' || kode === 'TIKET_LAMA') await onSuccess?.();
    } finally {
      setMengirim(false);
    }
  };

  const galatTujuanTampil = galatTujuan ?? galatMuat;

  return (
    <FormDialog
      judul={<><ArrowRightLeft size={18} aria-hidden="true" /> Alihkan tiket {tiket.nomor_display}</>}
      deskripsi={
        <>
          Tiket ini sekarang di layanan <strong>{tiket.layanan_nama}</strong>. Setelah dialihkan, tiket lama ditutup dan
          pengunjung mendapat nomor baru di layanan tujuan. Tindakan ini tercatat di riwayat audit beserta alasannya.
        </>
      }
      labelKirim="Alihkan"
      mengirim={mengirim}
      kirimNonaktif={memuat}
      galat={galat}
      onClose={onClose}
      onSubmit={kirim}
    >
      {() => (
        <>
          <div className="form-group">
            <label htmlFor={idLayanan} className="form-label form-label--required">Layanan tujuan</label>
            <select
              id={idLayanan}
              className="form-select"
              value={tujuan}
              disabled={mengirim}
              aria-required
              aria-invalid={galatTujuanTampil ? true : undefined}
              aria-describedby={galatTujuanTampil ? idLayananGalat : undefined}
              onChange={(e) => { setTujuan(e.target.value); setGalatTujuan(null); setGalat(null); }}
            >
              <option value="">{memuat ? 'Memuat layanan…' : '-- Pilih layanan tujuan --'}</option>
              {daftar.map((l) => (
                <option key={l.id} value={l.id}>{l.nama}</option>
              ))}
            </select>
            {galatTujuanTampil && (
              <p id={idLayananGalat} role="alert" style={{ color: 'var(--color-danger-600)', fontSize: 12, margin: '4px 0 0' }}>
                {galatTujuanTampil}
              </p>
            )}
          </div>

          <div className="form-group">
            <label htmlFor={idAlasan} className="form-label form-label--required">Alasan pengalihan</label>
            <textarea
              id={idAlasan}
              className="form-textarea"
              rows={3}
              value={alasan}
              maxLength={MAX_ALASAN_ALIHKAN}
              disabled={mengirim}
              aria-required
              aria-invalid={galatAlasan ? true : undefined}
              aria-describedby={galatAlasan ? `${idAlasanBantuan} ${idAlasanGalat}` : idAlasanBantuan}
              placeholder="Contoh: kebutuhan pemohon ternyata layanan Sertifikasi Halal"
              onChange={(e) => { setAlasan(e.target.value); setGalatAlasan(null); setGalat(null); }}
            />
            <small id={idAlasanBantuan} style={{ color: 'var(--text-tertiary)' }}>
              {MIN_ALASAN_ALIHKAN}-{MAX_ALASAN_ALIHKAN} karakter.
            </small>
            {galatAlasan && (
              <p id={idAlasanGalat} role="alert" style={{ color: 'var(--color-danger-600)', fontSize: 12, margin: '4px 0 0' }}>
                {galatAlasan}
              </p>
            )}
          </div>
        </>
      )}
    </FormDialog>
  );
}
