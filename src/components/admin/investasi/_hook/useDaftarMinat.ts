'use client';

// Daftar Kotak Masuk: saringan jenis/status, pencarian seluruh pesan, dan paginasi. Data lewat lib/data/investasi.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { daftarMinat, type MinatRingkas } from '@/lib/data/investasi';
import {
  UKURAN_HALAMAN_KOTAK_MASUK,
  type SaringanJenis,
  type SaringanStatus,
} from '../KotakMasukLogika';

export function useDaftarMinat() {
  const [jenis, setJenisState] = useState<SaringanJenis>('semua');
  const [status, setStatusState] = useState<SaringanStatus>('semua');
  const [cari, setCariState] = useState('');
  const [halaman, setHalaman] = useState(0);
  const [baris, setBaris] = useState<MinatRingkas[]>([]);
  const [total, setTotal] = useState(0);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState('');
  const urutan = useRef(0);

  const muat = useCallback(async () => {
    const saya = ++urutan.current;
    setMemuat(true);
    setGalat('');
    try {
      const dari = halaman * UKURAN_HALAMAN_KOTAK_MASUK;
      const { data, error, count } = await daftarMinat(createClient(), {
        ...(jenis !== 'semua' ? { kanal: jenis } : {}),
        ...(status !== 'semua' ? { status } : {}),
        ...(cari.trim() ? { cari: cari.trim() } : {}),
        dari,
        sampai: dari + UKURAN_HALAMAN_KOTAK_MASUK - 1,
      });
      if (saya !== urutan.current) return;
      if (error) throw new Error(error.message);
      setBaris(data ?? []);
      const jumlah = count ?? data?.length ?? 0;
      setTotal(jumlah);
      const terakhir = Math.max(0, Math.ceil(jumlah / UKURAN_HALAMAN_KOTAK_MASUK) - 1);
      if (halaman > terakhir) setHalaman(terakhir);
    } catch {
      if (saya !== urutan.current) return;
      setGalat('Kotak masuk belum dapat dimuat. Pastikan Anda masuk sebagai pengelola investasi.');
    } finally {
      if (saya === urutan.current) setMemuat(false);
    }
  }, [halaman, jenis, status, cari]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void muat();
  }, [muat]);

  const setJenis = useCallback((nilai: SaringanJenis) => { setJenisState(nilai); setHalaman(0); }, []);
  const setStatus = useCallback((nilai: SaringanStatus) => { setStatusState(nilai); setHalaman(0); }, []);
  const setCari = useCallback((nilai: string) => { setCariState(nilai); setHalaman(0); }, []);

  /** Terapkan ulang saringan, total dan paginasi setelah status diubah di panel. */
  const perbaruiBaris = useCallback(() => { void muat(); }, [muat]);

  return {
    jenis, setJenis, status, setStatus, cari, setCari, halaman, setHalaman,
    baris, total, memuat, galat, muat, perbaruiBaris,
  };
}
