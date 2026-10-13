// Helper mutasi Supabase yang SELALU dicek (audit T2: "notifikasi sukses palsu").
//
// supabase-js TIDAK melempar: kegagalan kembali sebagai `{ error }`, dan penolakan
// RLS pada UPDATE/DELETE = 0 baris terdampak TANPA error (INSERT yang melanggar
// WITH CHECK menghasilkan error 42501). Kode yang langsung memanggil toast sukses
// setelah `await` tanpa memeriksa hasil melaporkan sukses palsu. Helper ini
// membungkus query dan MELEMPAR `MutasiError` bila ada masalah, sehingga pola benar
// cukup satu baris dan tidak bergantung pada ingatan:
//
//   const baris = await mutasiWajibBaris(
//     supabase.from('faq_knowledge_base').update({ ... }).eq('id', id).select('id'),
//   );
//
// Modul ini sengaja MURNI (tanpa logger/server-only) agar aman dipakai di komponen
// klien maupun route handler; pemanggil sisi server mencatat `e.kode`/`e.asal` sendiri
// lewat `logServerEvent`. Rancangan: docs/superpowers/specs/2026-10-12-mutasi-tercek-design.md §3.1.

export type KodeMutasi = 'jaringan' | 'ditolak' | 'tidak_ada_baris' | 'database';

// Bentuk error minimal: PostgrestError milik supabase-js memenuhinya secara struktural,
// tanpa perlu mengimpor tipe PostgREST yang rapuh antarversi.
export interface ErrorLike {
  message: string;
  code?: string;
  status?: number;
}

// Hasil query minimal: builder supabase-js (thenable) memenuhinya secara struktural.
// `data` bisa array, satu objek (.single()/.maybeSingle()), atau null.
export interface HasilQuery<T> {
  data: T[] | T | null;
  error: ErrorLike | null;
  status?: number;
}

const PESAN_DEFAULT: Record<KodeMutasi, string> = {
  jaringan: 'Koneksi bermasalah, periksa jaringan Anda lalu coba lagi',
  ditolak: 'Anda tidak berwenang melakukan perubahan ini',
  tidak_ada_baris: 'Anda tidak berwenang mengubah data ini atau data sudah tidak ada',
  database: 'Terjadi kesalahan saat menyimpan data, coba lagi',
};

export class MutasiError extends Error {
  /** Kategori kegagalan (untuk percabangan UI dan logging). */
  readonly kode: KodeMutasi;
  /** Pesan berbahasa Indonesia, siap ditampilkan (toast). Tidak memuat detail teknis. */
  readonly pesan: string;
  /** Error asli (PostgrestError / alasan penolakan) untuk logging pemanggil; jangan ditampilkan ke pengguna. */
  readonly asal?: unknown;

  constructor(kode: KodeMutasi, opsi: { pesan?: string; asal?: unknown } = {}) {
    super(opsi.pesan ?? PESAN_DEFAULT[kode]);
    this.name = 'MutasiError';
    this.kode = kode;
    this.pesan = this.message;
    this.asal = opsi.asal;
  }
}

// 42501 = insufficient_privilege (dipakai Postgres untuk pelanggaran RLS dan GRANT).
const POLA_DITOLAK = /row-level security|permission denied/i;
// Pesan khas kegagalan fetch di berbagai peramban/runtime ("Load failed" = Safari).
const POLA_JARINGAN = /fetch|network|timeout|timed out|load failed|abort|econn|enotfound/i;
// Kode error dari server database: SQLSTATE (5 karakter [0-9A-Z]) atau PGRST###.
// SQLSTATE WAJIB memuat minimal satu digit: setiap kode PostgreSQL (00000, 22P02, 42501, 57014, P0001, XX000,
// HV00J, ...) punya digit, sedangkan errno Node 5 huruf (EPIPE, EPERM, EBUSY, EBADF, EXDEV, EROFS) murni huruf
// dan merupakan kegagalan transport (-> 'jaringan'), bukan balasan server database. Pembeda "awalan E" sengaja
// tidak dipakai (tidak berlaku umum); syarat "ada digit" lebih tepat dan mencakup semua errno 5 huruf.
const POLA_KODE_DB = /^(?=.*\d)[0-9A-Z]{5}$|^PGRST\d+$/;

function klasifikasiError(error: ErrorLike, statusRespons?: number): KodeMutasi {
  const kode = typeof error.code === 'string' ? error.code : '';
  const pesan = typeof error.message === 'string' ? error.message : '';

  if (kode === '42501' || POLA_DITOLAK.test(pesan)) return 'ditolak';

  // supabase-js mengembalikan status 0 + code '' bila fetch itu sendiri gagal. Pencocokan pesan
  // hanya berlaku saat TIDAK ada kode dari server, agar mis. "statement timeout" (57014)
  // tidak salah dilabeli masalah jaringan.
  const status = statusRespons ?? error.status;
  if (status === 0 || (!kode && POLA_JARINGAN.test(pesan))) return 'jaringan';

  return 'database';
}

// Promise yang menolak (mis. fetch melempar, atau builder dengan .throwOnError()).
function dariPenolakan(alasan: unknown): MutasiError {
  if (alasan instanceof MutasiError) return alasan;
  if (typeof alasan === 'object' && alasan !== null) {
    const kode = (alasan as { code?: unknown }).code;
    // Penolakan yang jelas berasal dari server database diklasifikasikan menurut kodenya.
    if (typeof kode === 'string' && POLA_KODE_DB.test(kode)) {
      return new MutasiError(klasifikasiError(alasan as ErrorLike), { asal: alasan });
    }
  }
  // Selebihnya (TypeError fetch, abort, dst.) diperlakukan sebagai kegagalan jaringan.
  return new MutasiError('jaringan', { asal: alasan });
}

function keArray<T>(data: T[] | T | null | undefined): T[] {
  if (data === null || data === undefined) return [];
  return Array.isArray(data) ? data : [data];
}

async function jalankan<T>(query: PromiseLike<HasilQuery<T>>): Promise<T[]> {
  let hasil: HasilQuery<T>;
  try {
    hasil = await query;
  } catch (alasan) {
    throw dariPenolakan(alasan);
  }
  if (typeof hasil !== 'object' || hasil === null) {
    throw new MutasiError('database', { asal: hasil });
  }
  if (hasil.error) {
    throw new MutasiError(klasifikasiError(hasil.error, hasil.status), { asal: hasil.error });
  }
  return keArray(hasil.data);
}

/**
 * Untuk UPDATE/DELETE. Melempar `MutasiError` bila `error` ada ATAU tidak ada baris terdampak
 * (kode `tidak_ada_baris`: RLS menolak diam-diam, atau baris sudah tidak ada).
 *
 * Query HARUS berakhir `.select('id')` (atau kolom lain) supaya baris terdampak terlihat;
 * tanpa `.select()` supabase-js tidak mengembalikan baris sehingga helper ini selalu melempar
 * `tidak_ada_baris`. Mengembalikan baris terdampak sebagai array (objek tunggal dari
 * `.single()`/`.maybeSingle()` dinormalkan menjadi array satu elemen).
 */
export async function mutasiWajibBaris<T = unknown>(query: PromiseLike<HasilQuery<T>>): Promise<T[]> {
  const baris = await jalankan(query);
  if (baris.length === 0) throw new MutasiError('tidak_ada_baris');
  return baris;
}

/**
 * Untuk INSERT/UPSERT. Melempar `MutasiError` bila `error` ada (mis. `ditolak` untuk
 * pelanggaran WITH CHECK, kode 42501). Mengembalikan baris bila query memakai `.select()`;
 * query tanpa `.select()` mengembalikan array kosong dan tidak dianggap gagal.
 */
export async function mutasiInsert<T = unknown>(query: PromiseLike<HasilQuery<T>>): Promise<T[]> {
  return jalankan(query);
}

/**
 * Untuk UPDATE/DELETE yang SENGAJA idempoten: 0 baris terdampak dianggap sah (mis. menghapus baris
 * yang mungkin sudah tidak ada, `jam_pulang IS NULL` yang sudah terisi). Tetap melempar `MutasiError`
 * bila `error` ada. Pakai `mutasiWajibBaris` bila 0 baris berarti gagal (penolakan RLS diam-diam).
 * Aturan lint menerima salah satu dari keduanya untuk UPDATE/DELETE; memilih ini = keputusan sadar.
 */
export async function mutasiBolehKosong<T = unknown>(query: PromiseLike<HasilQuery<T>>): Promise<T[]> {
  return jalankan(query);
}

/**
 * Pesan siap tampil (toast) untuk error hasil helper di atas. `MutasiError` -> `pesan`-nya;
 * error lain/unknown -> `fallback` (atau pesan umum), tanpa membocorkan `message` teknis.
 */
export function pesanMutasi(e: unknown, fallback?: string): string {
  if (e instanceof MutasiError) return e.pesan;
  return fallback ?? PESAN_DEFAULT.database;
}
