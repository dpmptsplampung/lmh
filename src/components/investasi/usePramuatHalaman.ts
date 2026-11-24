'use client';

import { useCallback, useEffect, useRef } from 'react';
import { tetanggaPrefetch } from './dokumen-logika';

/** Jarak (halaman) dari halaman aktif yang masih disimpan di memori; sisanya dilepas. */
const JARAK_SIMPAN = 3;

export const urlGambarHalaman = (dokumenId: string, halaman: number) =>
  `/api/investment-docs/page-image?doc_id=${dokumenId}&page=${halaman}`;

/**
 * Pramuat halaman tetangga (satu ke depan, satu ke belakang) setelah halaman aktif siap.
 * Server menyajikan gambar `no-store` (watermark per peminta), jadi cache HTTP tidak membantu: gambar diambil dengan
 * fetch dan disimpan sebagai URL objek Blob yang dipakai langsung saat pengguna pindah. Semua permintaan dibatalkan
 * dan semua URL objek dilepas saat penampil ditutup. Mode hemat data tidak memramuat.
 */
export function usePramuatHalaman(dokumenId: string, halaman: number, jumlahHalaman: number, aktif: boolean) {
  const tersimpan = useRef(new Map<number, string>());
  const berjalan = useRef(new Set<number>());
  // Sumber yang sudah dipilih per halaman+percobaan dibekukan agar gambar tak dimuat ulang saat blob datang terlambat.
  const dipilih = useRef(new Map<string, string>());
  const pembatal = useRef<AbortController | null>(null);

  useEffect(() => {
    const blobTersimpan = tersimpan.current;
    const dipilihSaatIni = dipilih.current;
    return () => {
      pembatal.current?.abort();
      pembatal.current = null;
      blobTersimpan.forEach(u => URL.revokeObjectURL(u));
      blobTersimpan.clear();
      dipilihSaatIni.clear();
    };
  }, []);

  useEffect(() => {
    if (!aktif || typeof fetch !== 'function' || typeof URL.createObjectURL !== 'function') return;
    const koneksi = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (koneksi?.saveData) return;
    pembatal.current ??= new AbortController();
    const sinyal = pembatal.current.signal;

    // Lepas halaman yang terlalu jauh (kecuali yang masih dipakai gambar tampil lewat `dipilih`).
    for (const [n, u] of Array.from(tersimpan.current)) {
      if (Math.abs(n - halaman) <= JARAK_SIMPAN) continue;
      tersimpan.current.delete(n);
      for (const [k, v] of Array.from(dipilih.current)) if (v === u) dipilih.current.delete(k);
      URL.revokeObjectURL(u);
    }

    for (const n of tetanggaPrefetch(halaman, jumlahHalaman)) {
      if (tersimpan.current.has(n) || berjalan.current.has(n)) continue;
      berjalan.current.add(n);
      (async () => {
        try {
          const res = await fetch(urlGambarHalaman(dokumenId, n), { signal: sinyal });
          if (!res.ok) return;
          const blob = await res.blob();
          if (sinyal.aborted) return;
          tersimpan.current.set(n, URL.createObjectURL(blob));
        } catch {
          // pramuat gagal: halaman dimuat biasa saat dibuka
        } finally {
          berjalan.current.delete(n);
        }
      })();
    }
  }, [dokumenId, halaman, jumlahHalaman, aktif]);

  /** URL gambar untuk halaman: blob bila sudah dipramuat, selain itu langsung dari server. Percobaan ulang selalu langsung. */
  const sumber = useCallback((n: number, percobaan: number) => {
    const kunci = `${n}:${percobaan}`;
    const ada = dipilih.current.get(kunci);
    if (ada) return ada;
    const pilihan = (percobaan === 0 ? tersimpan.current.get(n) : undefined) ?? urlGambarHalaman(dokumenId, n);
    dipilih.current.set(kunci, pilihan);
    return pilihan;
  }, [dokumenId]);

  return { sumber };
}
