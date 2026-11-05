'use client';

import { useEffect, useState } from 'react';
import { DURASI_HALAMAN_MS, UKURAN_HALAMAN, bagiHalaman } from './tataLayar';

/**
 * Halaman layar TV: paling banyak `ukuran` kartu per halaman, berganti tiap `durasiMs` secara berputar.
 * Pergantian hanya bergantung pada JUMLAH halaman, bukan pada identitas larik, jadi muat ulang data
 * (larik baru tiap polling) tidak mengulang hitung mundur.
 */
export function useHalaman<T>(
  semua: T[],
  { ukuran = UKURAN_HALAMAN, durasiMs = DURASI_HALAMAN_MS }: { ukuran?: number; durasiMs?: number } = {},
): { item: T[]; indeks: number; total: number } {
  const halaman = bagiHalaman(semua, ukuran);
  const total = halaman.length;
  const [mentah, setMentah] = useState(0);

  useEffect(() => {
    if (total <= 1) return;
    const t = setInterval(() => setMentah(i => i + 1), durasiMs);
    return () => clearInterval(t);
  }, [total, durasiMs]);

  // Indeks diturunkan saat render: jumlah halaman yang menyusut tidak meninggalkan indeks di luar rentang.
  const indeks = total > 0 ? mentah % total : 0;
  return { item: halaman[indeks] ?? [], indeks, total };
}
