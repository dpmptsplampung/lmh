// Layar TV antrean: status jadwal layanan dan kisi yang muat satu layar (aturan tampilan: tataLayar.ts).
// Keputusan buka/tutup/jadwal TIDAK dihitung di sini: sumbernya RPC `layanan_status_hari_ini`
// (migrasi 202610280001), yang memakai `is_layanan_buka_jadwal` (arsip, hari libur, pengecualian,
// pola mingguan, jam WIB sekarang). Di sini hanya memetakan jawabannya.
import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

/** `hari` = hari kerja terjadwal (1=Senin..7=Minggu) dari kolom `jadwal` RPC; kosong = tanpa jadwal. */
export type StatusBukaLayanan = { buka: boolean; libur: string | null; hari: number[] };
export type PetaStatusBuka = Map<string, StatusBukaLayanan>;

/** `jadwal` jsonb RPC -> hari kerja unik (1..7) terurut; selain larik atau nilai di luar rentang diabaikan. */
function hariTerjadwal(jadwal: unknown): number[] {
  if (!Array.isArray(jadwal)) return [];
  const hari = new Set<number>();
  for (const j of jadwal as Array<Record<string, unknown> | null>) {
    const h = j?.hari;
    if (typeof h === 'number' && Number.isInteger(h) && h >= 1 && h <= 7) hari.add(h);
  }
  return [...hari].sort((a, b) => a - b);
}

/**
 * Jawaban RPC -> peta per layanan. Bukan larik (RPC belum diterapkan atau jawaban tak terduga) = null,
 * artinya status tidak diketahui; pemanggil tidak boleh menebak jadwal.
 */
export function petaStatusBuka(data: unknown): PetaStatusBuka | null {
  if (!Array.isArray(data)) return null;
  const peta: PetaStatusBuka = new Map();
  for (const r of data as Array<Record<string, unknown>>) {
    const id = typeof r?.layanan_id === 'string' ? r.layanan_id : '';
    if (!id || typeof r.buka_sekarang !== 'boolean') continue;
    const libur = typeof r.libur_keterangan === 'string' && r.libur_keterangan.trim() ? r.libur_keterangan : null;
    peta.set(id, { buka: r.buka_sekarang, libur, hari: hariTerjadwal(r.jadwal) });
  }
  return peta;
}

/** Ambil status buka/tutup semua layanan publik; gagal atau RPC belum ada -> null. */
export async function ambilStatusBuka(sb: Pick<SupabaseClient, 'rpc'>): Promise<PetaStatusBuka | null> {
  try {
    const { data, error } = await sb.rpc('layanan_status_hari_ini');
    if (error) return null;
    return petaStatusBuka(data);
  } catch {
    return null;
  }
}

/** Keterangan hari libur (bila hari ini libur menurut kalender), untuk pesan "semua tutup". */
export function keteranganLibur(status: PetaStatusBuka | null): string | null {
  if (!status) return null;
  for (const s of status.values()) if (s.libur) return s.libur;
  return null;
}

const RASIO_BAWAAN = 16 / 9;
/** Perbandingan lebar:tinggi kartu yang paling nyaman dibaca. */
const RASIO_KARTU_IDEAL = 1.5;
/** Bobot hukuman untuk sel kosong di baris terakhir. */
const BOBOT_SEL_KOSONG = 0.35;

/**
 * Kisi (kolom x baris) yang memuat n kartu dalam SATU layar tanpa scroll.
 * Memilih kolom yang membuat kartu paling mendekati bentuk ideal dan paling sedikit sel kosong.
 * `rasio` = lebar/tinggi area kartu (bawaan 16:9).
 */
export function tataKisi(n: number, rasio: number = RASIO_BAWAAN): { kolom: number; baris: number } {
  const jumlah = Math.max(1, Math.floor(Number.isFinite(n) ? n : 1));
  const r = Number.isFinite(rasio) && rasio > 0 ? rasio : RASIO_BAWAAN;
  let terbaik = { kolom: 1, baris: jumlah };
  let skorTerbaik = Infinity;
  for (let kolom = 1; kolom <= jumlah; kolom++) {
    const baris = Math.ceil(jumlah / kolom);
    const rasioKartu = (r * baris) / kolom;
    const kosong = kolom * baris - jumlah;
    const skor = Math.abs(Math.log(rasioKartu / RASIO_KARTU_IDEAL)) + BOBOT_SEL_KOSONG * (kosong / jumlah);
    if (skor < skorTerbaik) {
      skorTerbaik = skor;
      terbaik = { kolom, baris };
    }
  }
  return terbaik;
}

/**
 * Ukur rasio lebar:tinggi area kartu (bukan seluruh layar: header dan footer ikut mengurangi tinggi).
 * Pasang `ref` pada elemen kisi. Tanpa ukuran (tes, render pertama) memakai 16:9.
 */
export function useRasioArea(): { ref: (el: HTMLElement | null) => void; rasio: number } {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [rasio, setRasio] = useState(RASIO_BAWAAN);
  useEffect(() => {
    if (!el) return;
    const ukur = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setRasio(Math.round((width / height) * 20) / 20);
    };
    ukur();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', ukur);
      return () => window.removeEventListener('resize', ukur);
    }
    const pengamat = new ResizeObserver(ukur);
    pengamat.observe(el);
    return () => pengamat.disconnect();
  }, [el]);
  return { ref: setEl, rasio };
}
