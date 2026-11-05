'use client';

// Sesi kerja petugas hari ini untuk widget sidebar: absensi_petugas milik sendiri (RLS absensi_select_own),
// tanggal = todayWIB(). Satu kueri saat dipasang; durasi dihitung ulang di klien tiap menit (tanpa kueri baru).
// Gagal/kolom tiada = status 'tidakTersedia' (tampilan netral, bukan galat).
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { todayWIB } from '@/lib/time';

export type StatusSesi = 'memuat' | 'belum' | 'menunggu' | 'hadir' | 'pulang' | 'ditolak' | 'tidakTersedia';

export interface BarisAbsensi {
  jam_masuk: string | null;
  jam_pulang: string | null;
  status?: string | null;
}

export interface RingkasSesi {
  status: StatusSesi;
  /** "07.58" (WIB) bila sudah hadir. */
  jamMasuk: string | null;
  jamPulang: string | null;
  /** "3 j 12 m" selama hadir; null selain itu. */
  durasi: string | null;
}

const jamFormatter = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "07.58" menurut WIB; null bila tanggal tak valid. */
export function jamWIB(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return jamFormatter.format(d).replace(':', '.');
}

/** Durasi ringkas seragam: "12 m", "1 j 5 m", "3 j". Negatif/NaN dianggap 0. */
export function formatDurasiRingkas(menit: number): string {
  const m = Number.isFinite(menit) && menit > 0 ? Math.floor(menit) : 0;
  const jam = Math.floor(m / 60);
  const sisa = m % 60;
  if (jam === 0) return `${sisa} m`;
  return sisa === 0 ? `${jam} j` : `${jam} j ${sisa} m`;
}

/** Murni: dari baris absensi hari ini (atau null bila belum ada) dan waktu sekarang menjadi ringkasan tampil. */
export function ringkasSesi(baris: BarisAbsensi | null, sekarang: Date): RingkasSesi {
  const kosong: RingkasSesi = { status: 'belum', jamMasuk: null, jamPulang: null, durasi: null };
  if (baris?.status === 'pending') return { ...kosong, status: 'menunggu' };
  if (!baris || !baris.jam_masuk) return kosong;
  if (baris.status === 'ditolak') return { ...kosong, status: 'ditolak' };
  const masuk = new Date(baris.jam_masuk);
  if (Number.isNaN(masuk.getTime())) return kosong;
  const jamMasuk = jamWIB(baris.jam_masuk);
  if (baris.jam_pulang) {
    return { status: 'pulang', jamMasuk, jamPulang: jamWIB(baris.jam_pulang), durasi: null };
  }
  const menit = Math.floor((sekarang.getTime() - masuk.getTime()) / 60000);
  return { status: 'hadir', jamMasuk, jamPulang: null, durasi: formatDurasiRingkas(menit) };
}

const MEMUAT: RingkasSesi = { status: 'memuat', jamMasuk: null, jamPulang: null, durasi: null };
const TIDAK_TERSEDIA: RingkasSesi = { status: 'tidakTersedia', jamMasuk: null, jamPulang: null, durasi: null };

type Muat = { tipe: 'memuat' } | { tipe: 'gagal' } | { tipe: 'ok'; baris: BarisAbsensi | null };

/**
 * @param petugasId petugas.id milik akun; null = tidak dimuat (status 'memuat' bila `aktif`, 'tidakTersedia' bila id kosong sesudah dimuat).
 * @param aktif     false = tidak ada kueri dan tidak ada timer (mis. widget peran lain).
 */
export function useSesiKerja(petugasId: string | null, aktif: boolean): RingkasSesi {
  const [muat, setMuat] = useState<Muat>({ tipe: 'memuat' });
  const [sekarang, setSekarang] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!aktif || !petugasId) return;
    let batal = false;
    (async () => {
      try {
        const { data, error } = await createClient()
          .from('absensi_petugas')
          .select('jam_masuk, jam_pulang, status')
          .eq('petugas_id', petugasId)
          .eq('tanggal', todayWIB())
          .maybeSingle();
        if (batal) return;
        if (error) setMuat({ tipe: 'gagal' });
        else setMuat({ tipe: 'ok', baris: (data as BarisAbsensi | null) ?? null });
      } catch {
        if (!batal) setMuat({ tipe: 'gagal' });
      }
    })();
    return () => {
      batal = true;
    };
  }, [aktif, petugasId]);

  const hadir = muat.tipe === 'ok' && ringkasSesi(muat.baris, new Date(sekarang)).status === 'hadir';
  useEffect(() => {
    if (!hadir) return;
    const t = setInterval(() => setSekarang(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [hadir]);

  if (!aktif) return MEMUAT;
  if (muat.tipe === 'gagal') return TIDAK_TERSEDIA;
  if (muat.tipe === 'memuat') return petugasId ? MEMUAT : TIDAK_TERSEDIA;
  return ringkasSesi(muat.baris, new Date(sekarang));
}
