'use client';

// Alur reservasi pengunjung (rencana refaktor 2026-11-11 tugas 9.2): isian formulir, profil pengunjung, kirim, dan layar
// berhasil. Menyusun dua hook lain: useKetersediaan (layanan, estimasi, pemeriksaan tanggal ke server) dan
// useDaftarReservasi (Reservasi Saya + batal). Aturan validasi ada di _logika/validasiReservasi.ts; query di
// lib/data/reservasi.ts.
//
// Urutan kirim (sama dengan halaman lama): validasiAwal -> periksaTanggal (server) -> persetujuan + sesi -> catat
// consent_log (gagal = reservasi TIDAK dibuat, S1) -> RPC reservasi_buat.
import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { buatReservasi, catatPersetujuanReservasi, muatPengunjungReservasi } from '@/lib/data/reservasi';
import {
  ISIAN_RESERVASI_KOSONG,
  batasTanggalReservasi,
  validasiAkhir,
  validasiAwal,
  type IsianReservasi,
} from '../_logika/validasiReservasi';
import { useDaftarReservasi } from './useDaftarReservasi';
import { useKetersediaan } from './useKetersediaan';

export interface ReservasiBerhasil {
  qr_token: string;
  tanggal_rencana: string;
}

export function useReservasi() {
  const [form, setForm] = useState<IsianReservasi>(ISIAN_RESERVASI_KOSONG);
  const [pengunjungId, setPengunjungId] = useState<string | null>(null);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingInit, setLoadingInit] = useState(true);
  const [error, setError] = useState('');
  // S1: pencatatan consent_log gagal -> reservasi tidak dibuat; ditampilkan lewat ErrorRetry (bukan teks biasa).
  const [consentGagal, setConsentGagal] = useState(false);
  const [success, setSuccess] = useState<ReservasiBerhasil | null>(null);
  const [consentGiven, setConsentGiven] = useState(false);

  const ketersediaan = useKetersediaan(form.layanan_id);
  const daftar = useDaftarReservasi(pengunjungId);
  const { muatLayanan } = ketersediaan;
  const { muatDaftar } = daftar;
  const { minDate, maxDate } = batasTanggalReservasi();

  // Muat awal berurutan: profil -> daftar reservasi -> layanan.
  useEffect(() => {
    let batal = false;
    async function muatAwal() {
      const profil = await muatPengunjungReservasi(createClient());
      if (!profil.error) {
        setAuthUserId(profil.data.authUserId);
        if (profil.data.pengunjungId) {
          setPengunjungId(profil.data.pengunjungId);
          await muatDaftar(profil.data.pengunjungId);
        }
      }
      await muatLayanan();
      if (!batal) setLoadingInit(false);
    }
    void muatAwal();
    return () => {
      batal = true;
    };
  }, [muatDaftar, muatLayanan]);

  const ubahForm = useCallback((perubahan: Partial<IsianReservasi>) => {
    setForm((f) => ({ ...f, ...perubahan }));
  }, []);

  /** Ganti tujuan sekaligus mengosongkan isian milik tujuan lain (nama untuk loket, layanan untuk bertemu). */
  const pilihTujuan = useCallback((tujuan: 'loket' | 'bertemu_seseorang') => {
    setForm((f) => (tujuan === 'loket' ? { ...f, tujuan, nama_yang_ditemui: '' } : { ...f, tujuan, layanan_id: '' }));
  }, []);

  const { periksaTanggal } = ketersediaan;

  // `e` opsional: tombol "Coba lagi" (ErrorRetry) memanggil ulang tanpa event submit.
  const kirim = async (e?: { preventDefault: () => void }) => {
    e?.preventDefault();
    setError('');
    setConsentGagal(false);

    const galatAwal = validasiAwal(form, maxDate);
    if (galatAwal) {
      setError(galatAwal);
      return;
    }
    const galatTanggal = await periksaTanggal(form);
    if (galatTanggal) {
      setError(galatTanggal);
      return;
    }
    const galatAkhir = validasiAkhir(consentGiven, pengunjungId);
    if (galatAkhir || !pengunjungId) {
      setError(galatAkhir ?? '');
      return;
    }

    setLoading(true);
    try {
      const sb = createClient();
      // Catat consent PDP sebelum RPC reservasi (audit S1, K11; pola K-2 di check-in).
      if (authUserId && consentGiven) {
        const consent = await catatPersetujuanReservasi(sb, authUserId);
        if (consent.error) {
          console.error('Consent reservasi gagal dicatat:', consent.error.asli);
          setConsentGagal(true);
          return;
        }
      }
      // Reservasi = baris `kunjungan` (RPC reservasi_buat, kontrak §4.1). Server memvalidasi ulang tanggal/jadwal/kuota.
      const hasil = await buatReservasi(sb, {
        tujuan: form.tujuan as 'loket' | 'bertemu_seseorang',
        layananId: form.layanan_id,
        namaYangDitemui: form.nama_yang_ditemui,
        tanggal: form.tanggal_rencana,
        jamRencana: form.jam_rencana,
        keperluan: form.keperluan,
      });
      if (hasil.error) {
        setError(hasil.error.pesan);
        // RESERVASI_GANDA bisa berarti percobaan sebelumnya sudah tersimpan (balasan hilang): segarkan daftar.
        if (hasil.error.kode === 'RESERVASI_GANDA') void muatDaftar(pengunjungId);
        console.error('Reservasi error:', hasil.error.asli);
        return;
      }
      setSuccess({ qr_token: hasil.data.qrToken, tanggal_rencana: hasil.data.tanggal });
      void muatDaftar(pengunjungId);
    } finally {
      setLoading(false);
    }
  };

  /** "Buat Reservasi Lain": kembali ke formulir kosong. */
  const mulaiLagi = useCallback(() => {
    setSuccess(null);
    setForm(ISIAN_RESERVASI_KOSONG);
  }, []);

  return {
    form,
    ubahForm,
    pilihTujuan,
    minDate,
    maxDate,
    loadingInit,
    loading,
    error,
    consentGagal,
    consentGiven,
    setConsentGiven,
    success,
    kirim,
    mulaiLagi,
    ketersediaan,
    daftar,
  };
}
