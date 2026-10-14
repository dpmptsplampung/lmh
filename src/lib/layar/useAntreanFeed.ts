'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { backoffMs, denganBatas, BATAS_WAKTU_MS } from './koneksi';

// Umpan data antrean untuk layar TV (audit T4). Bersama oleh /layar/[token] dan /layar-antrian.
//
// - Jalur utama: siaran realtime `antrean:publik` (payload tiket_id, layanan_id, nomor_display, status).
//   Satu aksi bisa menghasilkan dua siaran identik → muat ulang di-debounce (trailing) agar tidak
//   flicker / dobel fetch.
// - Cadangan: polling berkala.
// - Gangguan (error/jaringan/timeout) TIDAK menghapus data terakhir: `data` tetap, `reconnecting`
//   menjadi true, dan coba-ulang memakai backoff eksponensial (maks ~30 dtk) sampai pulih sendiri.

export interface HasilAmbil<T> {
  data: T[] | null;
  error: unknown;
}

export interface OpsiUmpan<T> {
  /** Umpan hanya berjalan bila true (mis. setelah token tervalidasi). */
  aktif: boolean;
  ambil: () => Promise<HasilAmbil<T>>;
  /** Dipanggil tiap pemuatan sukses; `sebelumnya` null pada pemuatan pertama. */
  saatData?: (sebelumnya: T[] | null, berikutnya: T[]) => void;
  pollMs?: number;
  debounceMs?: number;
  batasWaktuMs?: number;
}

export interface KeadaanUmpan<T> {
  data: T[];
  /** Waktu pemuatan sukses terakhir; null = belum pernah berhasil. */
  updatedAt: Date | null;
  /** Pemuatan terakhir gagal; data lama tetap ditampilkan. */
  reconnecting: boolean;
}

export function useAntreanFeed<T>(opsi: OpsiUmpan<T>): KeadaanUmpan<T> {
  const { aktif, pollMs = 15_000, debounceMs = 300, batasWaktuMs = BATAS_WAKTU_MS } = opsi;
  const [data, setData] = useState<T[]>([]);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [reconnecting, setReconnecting] = useState(false);

  // Simpan callback di effect (bukan saat render) — aturan react-hooks/refs.
  const ambilRef = useRef(opsi.ambil);
  const saatDataRef = useRef(opsi.saatData);
  useEffect(() => {
    ambilRef.current = opsi.ambil;
    saatDataRef.current = opsi.saatData;
  }, [opsi.ambil, opsi.saatData]);

  useEffect(() => {
    if (!aktif) return;

    let batal = false;
    let berjalan = false;
    let perluUlang = false;
    let gagalBeruntun = 0;
    let sebelumnya: T[] | null = null;
    let timerJadwal: ReturnType<typeof setTimeout> | null = null;
    let timerDebounce: ReturnType<typeof setTimeout> | null = null;

    const jadwalkan = (ms: number) => {
      if (timerJadwal) clearTimeout(timerJadwal);
      timerJadwal = setTimeout(() => { void muat(); }, ms);
    };

    const muat = async (): Promise<void> => {
      if (batal) return;
      if (berjalan) { perluUlang = true; return; }
      berjalan = true;
      let sukses = false;
      let baris: T[] = [];
      try {
        const hasil = await denganBatas(ambilRef.current(), batasWaktuMs);
        if (!hasil.error) {
          sukses = true;
          baris = hasil.data ?? [];
        }
      } catch {
        sukses = false;
      }
      berjalan = false;
      if (batal) return;

      if (sukses) {
        gagalBeruntun = 0;
        saatDataRef.current?.(sebelumnya, baris);
        sebelumnya = baris;
        setData(baris);
        setUpdatedAt(new Date());
        setReconnecting(false);
        const segera = perluUlang;
        perluUlang = false;
        jadwalkan(segera ? 0 : pollMs);
      } else {
        gagalBeruntun += 1;
        perluUlang = false;
        setReconnecting(true);
        jadwalkan(backoffMs(gagalBeruntun));
      }
    };

    const picu = () => {
      if (timerDebounce) clearTimeout(timerDebounce);
      timerDebounce = setTimeout(() => { void muat(); }, debounceMs);
    };

    // Realtime opsional: bila klien/channel tak tersedia, polling tetap menjaga layar.
    let supabase: ReturnType<typeof createClient> | null = null;
    let channel: ReturnType<ReturnType<typeof createClient>['channel']> | null = null;
    try {
      supabase = createClient();
      let pernahTersambung = false;
      channel = supabase
        .channel('antrean:publik')
        .on('broadcast', { event: '*' }, picu)
        .subscribe((status: string) => {
          if (status !== 'SUBSCRIBED') return;
          // Sambung ulang setelah putus: siaran yang terlewat dikejar dengan satu muat ulang.
          if (pernahTersambung) picu();
          pernahTersambung = true;
        });
    } catch {
      channel = null;
    }

    const saatOnline = () => { if (gagalBeruntun > 0) void muat(); };
    window.addEventListener('online', saatOnline);

    void muat();

    return () => {
      batal = true;
      if (timerJadwal) clearTimeout(timerJadwal);
      if (timerDebounce) clearTimeout(timerDebounce);
      window.removeEventListener('online', saatOnline);
      if (supabase && channel) void supabase.removeChannel(channel);
    };
  }, [aktif, pollMs, debounceMs, batasWaktuMs]);

  return { data, updatedAt, reconnecting };
}
