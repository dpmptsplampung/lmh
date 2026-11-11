// Daftar referensi kecil yang dipakai banyak halaman: layanan, petugas, topik penanganan, hari libur
// (rencana refaktor 2026-11-11 tugas 4.1, SPEC bagian 5).
//
// Aturan lapisan data:
// - Fungsi menerima SupabaseClient sebagai argumen pertama (klien browser dengan RLS pengguna ATAU klien server),
//   tanpa React dan tanpa toast. Pemanggil yang memutuskan cara menampilkan galat.
// - Tidak pernah melempar: hasilnya Hasil<T> = { data, error: null } | { data: null, error: string }.
// - `select` selalu daftar kolom eksplisit lewat konstanta KOLOM_*. Tabel referensi di daftar izin SPEC
//   (layanan, petugas, topik_penanganan, hari_libur) boleh tanpa .limit()/.range().
// - Aplikasi tetap berjalan sebelum migrasi baru diterapkan (SPEC bagian 9): kolom yang berasal dari migrasi yang
//   belum diterapkan diberi fallback (lihat muatLayananRingkas). Kolom lain di berkas ini sudah ada di produksi.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdminRole } from '@/lib/admin-nav';
import { kolomBelumAda } from '@/lib/akses-data/galat';

export type Hasil<T> = { data: T; error: null } | { data: null; error: string };

// ---------------------------------------------------------------------------------------------------------------
// Kolom
// ---------------------------------------------------------------------------------------------------------------

/** `slug` dan `diarsipkan_at` berasal dari migrasi Fase 1 (202610270001, docs/MIGRATIONS.md: belum diterapkan). */
export const KOLOM_LAYANAN_RINGKAS = 'id, nama, slug, form_pendataan, diarsipkan_at';
/** Kolom Layanan yang sudah ada sebelum Fase 1 (`form_pendataan` dari 202610140012, sudah diterapkan). */
export const KOLOM_LAYANAN_SEBELUM_FASE1 = 'id, nama, form_pendataan';
export const KOLOM_PETUGAS_RINGKAS = 'id, nama, role, layanan_id, aktif';
/** Topik aktif satu layanan untuk dropdown penyelesaian (urut dipakai pengurutan di server). */
export const KOLOM_TOPIK = 'id, nama, urut';
/** Semua topik (semua cakupan, termasuk nonaktif) untuk halaman Kelola Topik (Admin). */
export const KOLOM_TOPIK_ADMIN = 'id, layanan_id, nama, aktif, urut';
export const KOLOM_HARI_LIBUR = 'tanggal, keterangan';

/** Kunci cache `useReferensi` (klien/useReferensi.ts). Satu tempat agar pembuang cache memakai nama yang sama. */
export const KUNCI_REFERENSI = {
  layananRingkas: 'layanan-ringkas',
  petugasRingkas: 'petugas-ringkas',
  topik: (layananId: string) => `topik:${layananId}`,
} as const;

// ---------------------------------------------------------------------------------------------------------------
// Tipe baris
// ---------------------------------------------------------------------------------------------------------------

export interface LayananRingkas {
  id: string;
  nama: string;
  slug: string | null;
  /** Jenis formulir pendataan ('oss' | 'perizinan'); null = Layanan tanpa formulir. */
  form_pendataan: 'oss' | 'perizinan' | null;
  /** Terisi bila Layanan diarsipkan. */
  diarsipkan_at: string | null;
}

export interface PetugasRingkas {
  id: string;
  nama: string;
  role: AdminRole;
  layanan_id: string | null;
  aktif: boolean;
}

export interface TopikRingkas {
  id: string;
  nama: string;
  urut: number;
}

export interface TopikAdmin {
  id: string;
  /** null = topik Front Office. */
  layanan_id: string | null;
  nama: string;
  aktif: boolean;
  urut: number;
}

export interface HariLibur {
  /** YYYY-MM-DD. */
  tanggal: string;
  keterangan: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Pembaca
// ---------------------------------------------------------------------------------------------------------------

const PESAN_BAWAAN = 'Gagal memuat data.';

/** Pesan galat tidak kosong, apa pun bentuk galatnya (string kosong dari jaringan putus ikut dijaga). */
export function pesanGalatReferensi(e: unknown): string {
  if (typeof e === 'string') return e || PESAN_BAWAAN;
  if (typeof e === 'object' && e !== null && 'message' in e) {
    const pesan = (e as { message?: unknown }).message;
    if (typeof pesan === 'string' && pesan) return pesan;
  }
  return PESAN_BAWAAN;
}

/** Hasil mentah satu kueri; `error` tetap objek aslinya (memuat `code`) agar pemanggil dapat memilah galat. */
interface Mentah {
  data: unknown;
  error: unknown;
}

/** Menjalankan satu kueri tanpa pernah melempar: pengecualian jaringan menjadi `error`. */
async function bacaMentah(kueri: PromiseLike<Mentah>): Promise<Mentah> {
  try {
    const { data, error } = await kueri;
    return { data, error };
  } catch (e) {
    return { data: null, error: e || PESAN_BAWAAN };
  }
}

function keHasil<T>(mentah: Mentah): Hasil<T[]> {
  if (mentah.error) return { data: null, error: pesanGalatReferensi(mentah.error) };
  return { data: (mentah.data ?? []) as T[], error: null };
}

/** Menjalankan satu kueri daftar. Galat DB maupun pengecualian jaringan menjadi { data: null, error }. */
async function bacaDaftar<T>(kueri: PromiseLike<Mentah>): Promise<Hasil<T[]>> {
  return keHasil<T>(await bacaMentah(kueri));
}

/**
 * Semua Layanan (termasuk yang diarsipkan; pemanggil menyaring lewat `diarsipkan_at`), urut nama.
 *
 * Sebelum migrasi Fase 1 diterapkan, kolom `slug`/`diarsipkan_at` belum ada (Postgres 42703 / PostgREST PGRST204):
 * kueri diulang dengan kolom lama dan kolom baru diisi null, sehingga bentuk hasil tetap `LayananRingkas` (tidak ada
 * Layanan yang dianggap diarsipkan). Galat lain (izin, jaringan, tabel hilang) tidak memicu fallback dan dilaporkan
 * apa adanya. Hasil fallback bersifat sukses biasa (ikut cache `useReferensi` sampai TTL habis).
 */
export async function muatLayananRingkas(sb: SupabaseClient): Promise<Hasil<LayananRingkas[]>> {
  const penuh = await bacaMentah(sb.from('layanan').select(KOLOM_LAYANAN_RINGKAS).order('nama'));
  if (!penuh.error || !kolomBelumAda(penuh.error)) return keHasil<LayananRingkas>(penuh);

  const lama = await bacaDaftar<Omit<LayananRingkas, 'slug' | 'diarsipkan_at'>>(
    sb.from('layanan').select(KOLOM_LAYANAN_SEBELUM_FASE1).order('nama'),
  );
  if (lama.error !== null) return lama;
  return { data: lama.data.map((baris) => ({ ...baris, slug: null, diarsipkan_at: null })), error: null };
}

/** Semua petugas (aktif maupun nonaktif; RLS membatasi sesuai peran pemanggil), urut nama. */
export function muatPetugasRingkas(sb: SupabaseClient): Promise<Hasil<PetugasRingkas[]>> {
  return bacaDaftar<PetugasRingkas>(sb.from('petugas').select(KOLOM_PETUGAS_RINGKAS).order('nama'));
}

/** Topik AKTIF milik satu Layanan, urut `urut` lalu nama (dropdown "Topik penanganan"). */
export function muatTopik(sb: SupabaseClient, layananId: string): Promise<Hasil<TopikRingkas[]>> {
  return bacaDaftar<TopikRingkas>(
    sb
      .from('topik_penanganan')
      .select(KOLOM_TOPIK)
      .eq('aktif', true)
      .eq('layanan_id', layananId)
      .order('urut')
      .order('nama'),
  );
}

/** Semua topik di semua cakupan (Front Office = layanan_id null) termasuk nonaktif; hanya untuk Kelola Topik. */
export function muatSemuaTopik(sb: SupabaseClient): Promise<Hasil<TopikAdmin[]>> {
  return bacaDaftar<TopikAdmin>(
    sb.from('topik_penanganan').select(KOLOM_TOPIK_ADMIN).order('urut').order('nama'),
  );
}

/** Hari libur pada rentang tanggal [dari, sampai] (YYYY-MM-DD, WIB; hitung lewat `lib/time.ts`), urut tanggal. */
export function muatHariLibur(sb: SupabaseClient, dari: string, sampai: string): Promise<Hasil<HariLibur[]>> {
  return bacaDaftar<HariLibur>(
    sb.from('hari_libur').select(KOLOM_HARI_LIBUR).gte('tanggal', dari).lte('tanggal', sampai).order('tanggal'),
  );
}
