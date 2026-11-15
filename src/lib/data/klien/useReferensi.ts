// Cache memori tingkat modul + penggabungan permintaan untuk daftar referensi (layanan, petugas, topik, ...).
// Rencana refaktor 2026-11-11 tugas 4.1, SPEC bagian 5. Bukan pustaka data umum: hanya untuk daftar kecil yang
// berubah jarang dan dibaca banyak komponen/halaman.
//
// Perilaku:
// - Kunci sama = satu penyimpanan. Permintaan yang bersamaan digabung (pemuat dipanggil sekali).
// - Hasil sukses dipakai ulang selama `ttlMs` (bawaan 5 menit). Setelah itu mount berikutnya memuat ulang
//   diam-diam: data lama tetap tampil sampai data baru tiba (tanpa kedipan "memuat").
// - `ttlMs: 0` = tanpa cache: hanya penggabungan permintaan yang bersamaan. Entri dibuang begitu pelanggan
//   terakhirnya lepas, jadi mount berikutnya selalu memuat dari awal dan tidak pernah melihat data lama.
// - Galat TIDAK disimpan: mount berikutnya selalu mencoba lagi. Sisa galat dibersihkan ketika pelanggan
//   terakhirnya lepas.
// - `segarkan()` membuang cache kunci itu lalu memuat ulang; hasil permintaan yang sudah digantikan dibuang.
// - Cache hidup selama dokumen browser hidup (navigasi klien Next mempertahankannya). Data per-pengguna yang
//   dibatasi RLS jangan dimasukkan ke sini tanpa memanggil `buangCacheReferensi()` saat pengguna berganti.
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { Hasil } from '../referensi';

export const TTL_REFERENSI_BAWAAN = 300_000;

export interface PotretReferensi<T> {
  data: T | null;
  /** true hanya selama belum ada data sama sekali (pembaruan diam-diam setelah TTL tidak menyalakannya). */
  memuat: boolean;
  galat: string | null;
}

export interface HasilReferensi<T> extends PotretReferensi<T> {
  /** Membuang cache kunci ini lalu memuat ulang. */
  segarkan: () => void;
}

export interface OpsiReferensi {
  ttlMs?: number;
}

type Pemuat<T> = () => Promise<Hasil<T>>;

interface Entri {
  potret: PotretReferensi<unknown>;
  /** Waktu (ms) pemuatan sukses terakhir; 0 = belum pernah sukses / sudah dibuang / basi. */
  ambilPada: number;
  /** Permintaan yang sedang berjalan (untuk penggabungan). */
  janji: Promise<void> | null;
  /** Bertambah tiap permintaan baru; hasil dari generasi lama dibuang. */
  generasi: number;
  /** TTL yang diminta pemakai terakhir (0 = tanpa cache, lihat catatan di atas). */
  ttlMs: number;
  pendengar: Set<() => void>;
}

// Potret konstan agar getSnapshot stabil (useSyncExternalStore membandingkan dengan Object.is).
const POTRET_AWAL: PotretReferensi<never> = { data: null, memuat: true, galat: null };
const POTRET_NONAKTIF: PotretReferensi<never> = { data: null, memuat: false, galat: null };

const gudang = new Map<string, Entri>();

function entriUntuk(kunci: string): Entri {
  let e = gudang.get(kunci);
  if (!e) {
    e = { potret: POTRET_AWAL, ambilPada: 0, janji: null, generasi: 0, ttlMs: TTL_REFERENSI_BAWAAN, pendengar: new Set() };
    gudang.set(kunci, e);
  }
  return e;
}

function umumkan(e: Entri, potret: PotretReferensi<unknown>): void {
  e.potret = potret;
  for (const cb of [...e.pendengar]) cb();
}

/**
 * Tanpa pelanggan dan tanpa permintaan berjalan: entri tanpa cache (`ttlMs` 0) dibuang seluruhnya, dan sisa galat
 * dibuang agar mount berikutnya tidak melihatnya sesaat (galat tidak di-cache).
 */
function rapikanBilaSepi(kunci: string, e: Entri): void {
  if (e.pendengar.size > 0 || e.janji) return;
  if (e.ttlMs <= 0 || (e.potret.galat !== null && e.ambilPada === 0)) {
    gudang.delete(kunci);
    return;
  }
  if (e.potret.galat !== null) e.potret = { ...e.potret, galat: null };
}

function berlangganan(kunci: string, cb: () => void): () => void {
  const e = entriUntuk(kunci);
  e.pendengar.add(cb);
  return () => {
    e.pendengar.delete(cb);
    rapikanBilaSepi(kunci, e);
  };
}

function mulaiMuat<T>(kunci: string, e: Entri, pemuat: Pemuat<T>): void {
  const generasi = ++e.generasi;
  const lama = e.potret.data;
  umumkan(e, { data: lama, memuat: lama === null, galat: null });
  e.janji = (async () => {
    let hasil: Hasil<T>;
    try {
      hasil = await pemuat();
    } catch (err) {
      hasil = { data: null, error: err instanceof Error && err.message ? err.message : 'Gagal memuat data.' };
    }
    if (generasi !== e.generasi) return; // sudah digantikan permintaan yang lebih baru
    e.janji = null;
    if (hasil.error === null) {
      e.ambilPada = Date.now();
      umumkan(e, { data: hasil.data, memuat: false, galat: null });
    } else {
      e.ambilPada = 0; // galat tidak di-cache
      umumkan(e, { data: e.potret.data, memuat: false, galat: hasil.error || 'Gagal memuat data.' });
    }
    rapikanBilaSepi(kunci, e);
  })();
}

function pastikanMuat<T>(kunci: string, pemuat: Pemuat<T>, ttlMs: number): void {
  const e = entriUntuk(kunci);
  e.ttlMs = ttlMs;
  if (e.janji) return; // permintaan yang sama sedang berjalan: gabung
  if (e.ambilPada > 0 && Date.now() - e.ambilPada < ttlMs) return; // masih segar
  mulaiMuat(kunci, e, pemuat);
}

function segarkanKunci<T>(kunci: string, pemuat: Pemuat<T>): void {
  const e = entriUntuk(kunci);
  e.ambilPada = 0;
  umumkan(e, { data: null, memuat: true, galat: null });
  mulaiMuat(kunci, e, pemuat);
}

/**
 * Menandai cache basi: kunci berawalan `awalan` (semua kunci bila kosong) dimuat ulang pada mount berikutnya.
 * Entri yang tidak sedang dipakai dibuang seluruhnya. Komponen yang sedang tampil tidak dipaksa render ulang
 * (pakai `segarkan()` bila perlu). Panggil setelah mengubah data referensi atau saat pengguna berganti.
 */
export function buangCacheReferensi(awalan = ''): void {
  for (const [kunci, e] of [...gudang]) {
    if (!kunci.startsWith(awalan)) continue;
    e.ambilPada = 0;
    if (e.pendengar.size === 0 && !e.janji) gudang.delete(kunci);
  }
}

/**
 * Daftar referensi ber-cache. `kunci` null = nonaktif (tidak memuat). `pemuat` boleh closure baru tiap render:
 * yang dipanggil selalu versi terbaru, tetapi ia tidak memicu muat ulang (hanya `kunci`/`ttlMs` yang memicu).
 */
export function useReferensi<T>(
  kunci: string | null,
  pemuat: Pemuat<T>,
  { ttlMs = TTL_REFERENSI_BAWAAN }: OpsiReferensi = {},
): HasilReferensi<T> {
  const pemuatRef = useRef(pemuat);
  useEffect(() => {
    pemuatRef.current = pemuat;
  });

  const langgan = useCallback(
    (cb: () => void) => (kunci === null ? () => {} : berlangganan(kunci, cb)),
    [kunci],
  );
  const potret = useSyncExternalStore(
    langgan,
    () => (kunci === null ? POTRET_NONAKTIF : (gudang.get(kunci)?.potret ?? POTRET_AWAL)),
    () => (kunci === null ? POTRET_NONAKTIF : POTRET_AWAL),
  );

  useEffect(() => {
    if (kunci === null) return;
    pastikanMuat(kunci, () => pemuatRef.current(), ttlMs);
  }, [kunci, ttlMs]);

  const segarkan = useCallback(() => {
    if (kunci !== null) segarkanKunci(kunci, () => pemuatRef.current());
  }, [kunci]);

  return { data: potret.data as T | null, memuat: potret.memuat, galat: potret.galat, segarkan };
}
