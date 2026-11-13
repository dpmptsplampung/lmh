'use client';

// Daftar "Reservasi Saya" + pembatalan (rencana refaktor 2026-11-11 tugas 9.2). Query lewat lib/data/reservasi.ts.
// Konfirmasi dua langkah: `mintaBatal(id)` membuka konfirmasi, `batalkan(id)` memanggil RPC. Setelah pembatalan (berhasil
// atau tidak) daftar selalu disegarkan karena status bisa berubah di server (mis. sudah check-in).
import { useCallback, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { batalkanReservasi, muatReservasiSaya } from '@/lib/data/reservasi';
import type { ReservasiKunjungan } from '@/lib/reservasi';

export function useDaftarReservasi(pengunjungId: string | null) {
  const [daftar, setDaftar] = useState<ReservasiKunjungan[]>([]);
  const [daftarGagal, setDaftarGagal] = useState(false);
  const [konfirmasiBatal, setKonfirmasiBatal] = useState<string | null>(null);
  const [membatalkan, setMembatalkan] = useState<string | null>(null);
  const [infoBatal, setInfoBatal] = useState('');
  const [galatBatal, setGalatBatal] = useState('');

  /** `idPengunjung` eksplisit: pemuatan awal terjadi sebelum `pengunjungId` hook ini sempat terisi. */
  const muatDaftar = useCallback(async (idPengunjung: string) => {
    const hasil = await muatReservasiSaya(createClient(), idPengunjung);
    if (hasil.error) {
      setDaftarGagal(true);
    } else {
      setDaftar(hasil.data);
      setDaftarGagal(false);
    }
  }, []);

  const muatUlang = useCallback(() => {
    if (pengunjungId) void muatDaftar(pengunjungId);
  }, [pengunjungId, muatDaftar]);

  const mintaBatal = useCallback((id: string) => {
    setInfoBatal('');
    setGalatBatal('');
    setKonfirmasiBatal(id);
  }, []);

  const tutupKonfirmasi = useCallback(() => setKonfirmasiBatal(null), []);

  const batalkan = useCallback(
    async (id: string) => {
      if (membatalkan) return;
      setMembatalkan(id);
      setGalatBatal('');
      setInfoBatal('');
      const hasil = await batalkanReservasi(createClient(), id);
      if (hasil.error) {
        setGalatBatal(hasil.error.pesan);
        console.error('Pembatalan reservasi gagal:', hasil.error.asli);
      } else {
        setInfoBatal('Reservasi dibatalkan.');
        setKonfirmasiBatal(null);
      }
      setMembatalkan(null);
      muatUlang();
    },
    [membatalkan, muatUlang],
  );

  return {
    daftar,
    daftarGagal,
    konfirmasiBatal,
    membatalkan,
    infoBatal,
    galatBatal,
    muatDaftar,
    muatUlang,
    mintaBatal,
    tutupKonfirmasi,
    batalkan,
  };
}
