'use client';

// Jalur darurat Admin: ambil alih tiket yang sedang dilayani orang lain (pemilik pergi / tidak aktif).
// RPC admin_ambil_alih (migrasi 202610140002): hanya Admin dengan sesi sah, alasan wajib (minimal 5 karakter),
// tercatat di audit_log (pemilik lama, pemilik baru, alasan). Status tiket TIDAK berubah; setelah ambil alih,
// Admin menjadi pemilik dan dapat mengisi pendataan lalu menyelesaikan tiket.
// Fase 3 (migrasi 202610290001): mode Koordinator memakai RPC yang sama polanya: `koordinator_tiket` (Koordinator
// Petugas Layanan, tiket di Layanannya; pemegang lama tetap boleh menyunting draf) dan `koordinator_fo` (Koordinator
// Front Office, tahap FO berjalan; `tiket.id` = id tahap penanganan). Pemegang lama menerima pemberitahuan.
import { useId, useState } from 'react';
import { UserCog } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import Field from '@/components/ui/Field';
import Tombol from '@/components/ui/Tombol';
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

export type ModeAmbilAlih = 'admin' | 'koordinator_tiket' | 'koordinator_fo';

interface Props {
  tiket: TiketAmbilAlih | null;
  /** Bawaan 'admin' (admin_ambil_alih). */
  mode?: ModeAmbilAlih;
  onClose: () => void;
  /** Dipanggil setelah berhasil (dan setelah galat yang menandakan tampilan basi) agar daftar dimuat ulang. */
  onSuccess?: () => void | Promise<void>;
}

export default function AmbilAlihTiketModal({ tiket, mode = 'admin', onClose, onSuccess }: Props) {
  const { toast } = useToast();
  const [alasan, setAlasan] = useState('');
  const [mengirim, setMengirim] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const idForm = useId();
  // Formulir bersih per tiket: pemanggil memasang komponen dengan `key={tiket.id}`.
  // Dialog (ui): fokus masuk ke isian pertama, Tab terjebak di dalam, Esc menutup kecuali saat mengirim.
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
        mode === 'koordinator_fo'
          ? supabase.rpc('koordinator_ambil_alih_fo', { p_penanganan_id: tiket.id, p_alasan: alasanBersih })
          : supabase.rpc(mode === 'koordinator_tiket' ? 'koordinator_ambil_alih_tiket' : 'admin_ambil_alih', {
              p_tiket_id: tiket.id, p_alasan: alasanBersih,
            }),
      );
      toast(
        mode === 'koordinator_fo'
          ? `Penanganan ${tiket.nomor_display} kini menjadi tanggung jawab Anda`
          : `Tiket ${tiket.nomor_display} kini menjadi tanggung jawab Anda`,
        'success',
      );
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
    <Dialog
      terbuka
      onTutup={onClose}
      dikunci={mengirim}
      judul={(
        <>
          <UserCog size={18} aria-hidden="true" /> {mode === 'koordinator_fo' ? 'Ambil alih penanganan' : 'Ambil alih tiket'} {tiket.nomor_display}
        </>
      )}
      deskripsi={(
        <>
          {mode === 'koordinator_fo' ? 'Penanganan' : 'Tiket'} ini sedang dipegang{' '}
          {tiket.pemilik_nama ? <strong>{tiket.pemilik_nama}</strong> : 'petugas lain'}.
          Setelah diambil alih, Anda menjadi penanggung jawab, pelayanan tercatat atas nama Anda, dan hanya Anda yang
          dapat menyelesaikannya.
          {mode === 'koordinator_tiket' && ' Petugas semula tetap dapat menyunting draf pendataan dan akan menerima pemberitahuan.'}
          {mode === 'koordinator_fo' && ' Petugas semula akan menerima pemberitahuan.'}
          {' '}Tindakan ini tercatat di riwayat audit beserta alasannya.
        </>
      )}
      kaki={(
        <>
          <Tombol varian="hantu" ukuran="kecil" onClick={onClose} disabled={mengirim}>
            Batal
          </Tombol>
          <Tombol type="submit" form={idForm} varian="utama" ukuran="kecil" disabled={mengirim} memuat={mengirim}>
            {mengirim ? 'Memproses…' : 'Ambil alih'}
          </Tombol>
        </>
      )}
    >
      <form id={idForm} onSubmit={kirim}>
        <Field
          label="Alasan ambil alih"
          wajib
          bantuan={`Minimal ${MIN_ALASAN_AMBIL_ALIH} karakter.`}
          galat={galat}
        >
          <textarea
            className="form-textarea"
            rows={3}
            value={alasan}
            required
            minLength={MIN_ALASAN_AMBIL_ALIH}
            maxLength={500}
            disabled={mengirim}
            onChange={(e) => {
              setAlasan(e.target.value);
              if (galat) setGalat(null);
            }}
            placeholder="Contoh: petugas pulang sakit, pemohon masih menunggu di loket"
          />
        </Field>
      </form>
    </Dialog>
  );
}
