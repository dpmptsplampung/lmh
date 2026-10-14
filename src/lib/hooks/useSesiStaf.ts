'use client';

// Heartbeat sesi tunggal staf (tugas A2). Kontrak server: supabase/migrations/202610140001_sesi_staf.sql.
//
// - ping_sesi({p_aktif}) tiap ~60 dtk. p_aktif = true hanya bila ada input pengguna sejak ping sebelumnya
//   (pointer/keyboard/scroll/touch) DAN tab sedang terlihat; tab tersembunyi tetap berdetak (heartbeat) dengan false.
// - valid + 'transisi'  -> daftarkan_sesi() sekali (sesi login lama sebelum cutover), lalu lanjut.
// - tidak valid ('digantikan' | 'idle' | 'tidak_terdaftar') -> keluar + /login?alasan=...
//   TANPA memanggil daftarkan_sesi (jangan rebutan sesi dengan perangkat yang baru login).
// - tutup: true -> peringatan terlihat (role=alert) TENGGANG detik, lalu keluar dengan alasan=tutup.
// - Galat jaringan/RPC: TIDAK logout; coba lagi di siklus berikut (penegakan keras ada di RPC mutasi).
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  daftarkanSesiStaf,
  keluarDariSesi,
  uraiHasilPing,
  urlLoginAlasan,
  type AlasanSesi,
} from '@/lib/sesi-staf';

export const INTERVAL_PING_MS = 60_000;
export const TENGGANG_TUTUP_DETIK = 60;

const EVENT_AKTIVITAS = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'wheel', 'touchstart'] as const;

export interface OpsiSesiStaf {
  intervalMs?: number;
  tenggangTutupDetik?: number;
  /** Navigasi keras setelah keluar; bawaan window.location.assign (reload penuh membersihkan state klien). */
  navigasi?: (url: string) => void;
}

export interface StatusSesiStaf {
  /** Sisa detik sebelum logout otomatis karena jam tutup; null bila tidak ada peringatan. */
  sisaTutupDetik: number | null;
}

function navigasiKeras(url: string): void {
  window.location.assign(url);
}

export function useSesiStaf(opsi: OpsiSesiStaf = {}): StatusSesiStaf {
  const intervalMs = opsi.intervalMs ?? INTERVAL_PING_MS;
  const tenggang = opsi.tenggangTutupDetik ?? TENGGANG_TUTUP_DETIK;
  const navigasiRef = useRef(opsi.navigasi ?? navigasiKeras);
  const [sisaTutupDetik, setSisaTutupDetik] = useState<number | null>(null);

  useEffect(() => {
    const supabase = createClient();
    // Muat halaman = tindakan pengguna: ping pertama melaporkan aktivitas.
    let adaAktivitas = true;
    let sedangPing = false;
    let selesai = false; // sudah memutuskan keluar / komponen dilepas
    let sudahDaftarTransisi = false;
    let hitungMundur: ReturnType<typeof setInterval> | null = null;

    const tandaiAktivitas = () => {
      adaAktivitas = true;
    };

    const keluar = async (alasan: AlasanSesi, akhiri: boolean) => {
      if (selesai) return;
      selesai = true;
      if (hitungMundur) clearInterval(hitungMundur);
      await keluarDariSesi(supabase, { akhiri });
      navigasiRef.current(urlLoginAlasan(alasan));
    };

    const mulaiPeringatanTutup = () => {
      if (hitungMundur || selesai) return;
      let sisa = tenggang;
      setSisaTutupDetik(sisa);
      hitungMundur = setInterval(() => {
        sisa -= 1;
        if (sisa <= 0) {
          setSisaTutupDetik(0);
          void keluar('tutup', true);
          return;
        }
        setSisaTutupDetik(sisa);
      }, 1000);
    };

    const ping = async () => {
      if (selesai || sedangPing) return;
      sedangPing = true;
      try {
        const terlihat = typeof document === 'undefined' || document.visibilityState !== 'hidden';
        const aktif = adaAktivitas && terlihat;
        // Aktivitas yang terjadi saat tab tersembunyi tidak dibuang: dilaporkan saat tab terlihat lagi.
        if (terlihat) adaAktivitas = false;

        const { data, error } = await supabase.rpc('ping_sesi', { p_aktif: aktif });
        if (selesai) return;
        if (error) {
          // Laporan aktivitas belum sampai: kirim ulang di siklus berikut.
          if (aktif) adaAktivitas = true;
          return;
        }

        const hasil = uraiHasilPing(data);
        if (hasil.jenis === 'tak_dikenal') return;
        if (hasil.jenis === 'tidak_valid') {
          await keluar(hasil.alasan, false);
          return;
        }

        if (hasil.status === 'transisi' && !sudahDaftarTransisi) {
          // Sesi login lama (sebelum cutover) belum punya baris: daftarkan sekali, lanjut. Gagal -> coba lagi
          // di siklus berikut; TIDAK mengeluarkan pengguna (server masih menerima selama transisi).
          const daftar = await daftarkanSesiStaf(supabase);
          if (daftar.status === 'terdaftar' || daftar.status === 'bukan_staf') sudahDaftarTransisi = true;
          if (selesai) return;
        }
        if (hasil.tutup) mulaiPeringatanTutup();
      } catch {
        // Jaringan putus: jangan logout, coba lagi di siklus berikut.
      } finally {
        sedangPing = false;
      }
    };

    for (const nama of EVENT_AKTIVITAS) {
      window.addEventListener(nama, tandaiAktivitas, { passive: true, capture: true });
    }
    const saatTerlihat = () => {
      if (document.visibilityState === 'visible') void ping();
    };
    document.addEventListener('visibilitychange', saatTerlihat);

    void ping();
    const timer = setInterval(() => void ping(), intervalMs);

    return () => {
      selesai = true;
      clearInterval(timer);
      if (hitungMundur) clearInterval(hitungMundur);
      for (const nama of EVENT_AKTIVITAS) window.removeEventListener(nama, tandaiAktivitas, true);
      document.removeEventListener('visibilitychange', saatTerlihat);
    };
  }, [intervalMs, tenggang]);

  return { sisaTutupDetik };
}
