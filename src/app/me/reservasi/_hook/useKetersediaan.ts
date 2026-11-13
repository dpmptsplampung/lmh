'use client';

// Ketersediaan reservasi (rencana refaktor 2026-11-11 tugas 9.2): daftar layanan yang dapat direservasi (C2-01: galat
// memuat dibedakan dari daftar kosong yang sah), estimasi antrean hari ini untuk layanan terpilih (I2), dan pemeriksaan
// tanggal ke server (hari libur untuk "bertemu seseorang", jadwal layanan untuk "loket"). Query lewat lib/data/reservasi.ts.
import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  cekHariLibur,
  cekLayananBuka,
  muatEstimasiAntrean,
  muatJadwalBerikutnya,
  muatLayananReservasi,
  type EstimasiAntreanLoket,
  type LayananReservasi,
} from '@/lib/data/reservasi';
import {
  PESAN_VALIDASI_RESERVASI,
  akhirPekan,
  pesanLayananTutup,
  type IsianReservasi,
} from '../_logika/validasiReservasi';

export type TanggalDiperiksa = Pick<IsianReservasi, 'tujuan' | 'layanan_id' | 'tanggal_rencana'>;

export function useKetersediaan(layananId: string) {
  const [layanan, setLayanan] = useState<LayananReservasi[]>([]);
  const [layananGalat, setLayananGalat] = useState(false);
  const [layananMemuat, setLayananMemuat] = useState(false);
  const [estimasi, setEstimasi] = useState<EstimasiAntreanLoket | null>(null);

  const muatLayanan = useCallback(async () => {
    setLayananMemuat(true);
    const hasil = await muatLayananReservasi(createClient());
    if (hasil.error) {
      setLayanan([]);
      setLayananGalat(true);
    } else {
      setLayanan(hasil.data);
      setLayananGalat(false);
    }
    setLayananMemuat(false);
  }, []);

  // Estimasi antrean layanan terpilih. Dibersihkan saat layanan berganti; respons basi diabaikan.
  useEffect(() => {
    if (!layananId) return;
    let dibatalkan = false;
    void muatEstimasiAntrean(createClient(), layananId).then((hasil) => {
      if (dibatalkan) return;
      setEstimasi(hasil.error ? null : hasil.data);
    });
    return () => {
      dibatalkan = true;
      setEstimasi(null);
    };
  }, [layananId]);

  /**
   * Pemeriksaan tanggal yang butuh server; mengembalikan pesan penolakan atau null (boleh lanjut). Galat baca
   * diperlakukan "tidak diketahui" -> tidak menolak; validasi sesungguhnya ada di DB (reservasi_buat).
   * - bertemu_seseorang: hanya Senin–Jumat dan bukan hari_libur.
   * - loket: mengikuti jadwal layanan (termasuk Sabtu) lewat RPC; bila tutup, sebut jadwal terdekat.
   */
  const periksaTanggal = useCallback(
    async ({ tujuan, layanan_id: idLayanan, tanggal_rencana: tanggal }: TanggalDiperiksa): Promise<string | null> => {
      if (tujuan === 'bertemu_seseorang') {
        if (akhirPekan(tanggal)) return PESAN_VALIDASI_RESERVASI.akhirPekan;
        const libur = await cekHariLibur(createClient(), tanggal);
        if (!libur.error && libur.data) return PESAN_VALIDASI_RESERVASI.libur;
      }
      if (tujuan === 'loket' && idLayanan) {
        const sb = createClient();
        const buka = await cekLayananBuka(sb, idLayanan, tanggal);
        if (!buka.error && buka.data === false) {
          const berikutnya = await muatJadwalBerikutnya(sb, idLayanan, tanggal);
          const nama = layanan.find((l) => l.id === idLayanan)?.nama ?? 'Layanan ini';
          return pesanLayananTutup(nama, berikutnya.error ? null : berikutnya.data);
        }
      }
      return null;
    },
    [layanan],
  );

  return { layanan, layananGalat, layananMemuat, muatLayanan, estimasi, periksaTanggal };
}
