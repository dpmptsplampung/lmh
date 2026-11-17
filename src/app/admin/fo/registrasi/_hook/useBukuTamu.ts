'use client';

// State, efek, dan aksi tab Buku Tamu: daftar ber-filter (tanggal + pencarian), halaman, catat tamu, catat keluar.
// Tanpa JSX. Jawaban basi dibuang lewat nomor permintaan.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/Toast';
import {
  catatKeluar as apiCatatKeluar,
  catatTamu,
  LIMIT_BUKU_TAMU,
  muatBukuTamu,
  type FilterBukuTamu,
  type MasukanTamu,
  type TamuBuku,
} from '@/lib/data/buku-tamu';
import { todayWIB } from '@/lib/time';
import { galatRentang, perluResetKeHariIni } from '../_logika/bukuTamu';

const JEDA_CARI_MS = 300;

export function useBukuTamu() {
  const { toast } = useToast();
  const [items, setItems] = useState<TamuBuku[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [dari, setDari] = useState(todayWIB);
  const [sampai, setSampai] = useState(todayWIB);
  const [cari, setCari] = useState('');
  const [q, setQ] = useState('');
  const [memuat, setMemuat] = useState(true);
  const [galatMuat, setGalatMuat] = useState('');
  const [sedangKeluar, setSedangKeluar] = useState<ReadonlySet<string>>(new Set());
  const permintaan = useRef(0);

  const galatTanggal = galatRentang(dari, sampai);
  const filter: FilterBukuTamu = { dari, sampai, q };

  const muat = useCallback(async (p: number, f: FilterBukuTamu) => {
    const no = ++permintaan.current;
    setMemuat(true);
    const hasil = await muatBukuTamu(f, p + 1);
    if (no !== permintaan.current) return; // jawaban basi dibuang
    if (hasil.error !== null) setGalatMuat(hasil.error);
    else {
      setItems(hasil.data.items);
      setTotal(hasil.data.total);
      setGalatMuat('');
    }
    setMemuat(false);
  }, []);

  useEffect(() => {
    if (galatRentang(dari, sampai)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void muat(page, { dari, sampai, q });
  }, [muat, page, dari, sampai, q]);

  // Pencarian ditunda sebentar supaya tidak memuat ulang di tiap ketukan.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ((lama) => {
        const baru = cari.trim();
        if (baru !== lama) setPage(0);
        return baru;
      });
    }, JEDA_CARI_MS);
    return () => clearTimeout(t);
  }, [cari]);

  const ubahRentang = useCallback((r: { dari: string; sampai: string }) => {
    setDari(r.dari);
    setSampai(r.sampai);
    setPage(0);
  }, []);

  const hariIni = useCallback(() => {
    const h = todayWIB();
    setDari(h);
    setSampai(h);
    setCari('');
    setQ('');
    setPage(0);
  }, []);

  /** Melempar Error(pesan) bila gagal agar formulir menampilkannya di tempat. */
  const catat = useCallback(async (masukan: MasukanTamu) => {
    const hasil = await catatTamu(masukan);
    if (hasil.error !== null) throw new Error(hasil.error);
    toast('Tamu dicatat.', 'success');
    // Tamu baru bertanggal hari ini: pastikan terlihat di daftar.
    if (perluResetKeHariIni({ dari, sampai, q }, todayWIB())) { hariIni(); return; }
    if (page === 0) await muat(0, { dari, sampai, q });
    else setPage(0);
  }, [toast, dari, sampai, q, page, hariIni, muat]);

  const catatKeluar = useCallback(async (id: string) => {
    setSedangKeluar((s) => new Set(s).add(id));
    const hasil = await apiCatatKeluar(id);
    setSedangKeluar((s) => {
      const baru = new Set(s);
      baru.delete(id);
      return baru;
    });
    if (hasil.error !== null) {
      toast(hasil.error, 'error');
      return;
    }
    const waktu = hasil.data.tamu.waktu_keluar;
    setItems((daftar) => daftar.map((t) => (t.id === id ? { ...t, waktu_keluar: waktu } : t)));
    toast('Waktu keluar dicatat.', 'success');
  }, [toast]);

  return {
    items, total, page, setPage, dari, sampai, cari, setCari, q, memuat, galatMuat, galatTanggal,
    filter, ubahRentang, hariIni, catat, catatKeluar, sedangKeluar,
    muatUlang: () => void muat(page, { dari, sampai, q }),
    batas: LIMIT_BUKU_TAMU,
  };
}
