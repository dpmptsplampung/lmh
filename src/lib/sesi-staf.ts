// Sesi tunggal staf (tugas A2; kontrak server = supabase/migrations/202610140001_sesi_staf.sql).
//
// Modul MURNI (tanpa server-only/logger) agar dipakai komponen klien, route handler, dan proxy.
// Keputusan CEO: satu akun satu sesi; login baru menimpa sesi lama; sesi lama otomatis keluar;
// logout otomatis saat idle dan setelah jam tutup. Penegakan keras ada di RPC server (sesi_valid()),
// klien hanya melakukan pendaftaran, heartbeat, dan logout yang sopan.
import type { SupabaseClient } from '@supabase/supabase-js';

/** Alasan yang boleh muncul di `/login?alasan=...`. */
export type AlasanSesi = 'digantikan' | 'idle' | 'tutup' | 'tidak_terdaftar';

const ALASAN_VALID: readonly AlasanSesi[] = ['digantikan', 'idle', 'tutup', 'tidak_terdaftar'];

export const PESAN_ALASAN_SESI: Record<AlasanSesi, string> = {
  digantikan: 'Akun Anda masuk di perangkat lain. Sesi di perangkat ini telah diakhiri; masuk kembali bila Anda ingin melanjutkan di sini.',
  idle: 'Anda keluar otomatis karena tidak ada aktivitas dalam waktu yang lama. Silakan masuk kembali.',
  tutup: 'Layanan sudah tutup, sehingga Anda keluar otomatis. Silakan masuk kembali pada jam layanan berikutnya.',
  tidak_terdaftar: 'Sesi Anda tidak terdaftar atau sudah berakhir. Silakan masuk kembali.',
};

/** Pesan bila pendaftaran sesi gagal setelah login (login dibatalkan, tidak diloloskan diam-diam). */
export const PESAN_SESI_GAGAL_DAFTAR =
  'Masuk berhasil, tetapi sesi Anda tidak dapat didaftarkan sehingga Anda dikeluarkan kembali. Silakan coba masuk lagi; bila berulang, hubungi Admin.';

/** Pesan khusus SESI_TANPA_KLAIM: token tidak memuat session_id (masalah konfigurasi, bukan salah pengguna). */
export const PESAN_SESI_TANPA_KLAIM =
  'Masuk dibatalkan: token sesi Anda tidak memuat identitas sesi (session_id), sehingga sesi tidak dapat didaftarkan. Hubungi Admin atau pengembang aplikasi.';

/** Nilai `?alasan=` -> AlasanSesi, atau null bila tidak dikenal (input URL tidak tepercaya). */
export function parseAlasanSesi(nilai: string | null | undefined): AlasanSesi | null {
  return ALASAN_VALID.find((a) => a === nilai) ?? null;
}

export function urlLoginAlasan(alasan: AlasanSesi): string {
  return `/login?alasan=${alasan}`;
}

const PERAN_STAF = ['admin', 'petugas', 'front_office'];

export function apakahPeranStaf(peran: unknown): boolean {
  return typeof peran === 'string' && PERAN_STAF.includes(peran);
}

// ---------------------------------------------------------------------------
// Pendaftaran setelah login
// ---------------------------------------------------------------------------

export type HasilDaftarSesi =
  | { status: 'terdaftar' }
  /** RPC menolak FORBIDDEN (bukan staf aktif): normal untuk pengunjung/mitra, BUKAN error. */
  | { status: 'bukan_staf' }
  /** Gagal (mis. SESI_TANPA_KLAIM atau jaringan): pemanggil WAJIB menggagalkan login dan memberi tahu pengguna. */
  | { status: 'gagal'; kode: 'tanpa_klaim' | 'lainnya' };

interface GalatRpc {
  message?: string;
  code?: string;
}

/**
 * Panggil `daftarkan_sesi` SEKALI setelah login STAF berhasil. Pemanggil hanya memanggil ini untuk
 * pengguna yang berperan staf; bila ternyata RPC menolak FORBIDDEN (mis. petugas nonaktif), hasilnya
 * 'bukan_staf' tanpa galat ke pengguna.
 */
export async function daftarkanSesiStaf(supabase: Pick<SupabaseClient, 'rpc'>): Promise<HasilDaftarSesi> {
  let error: GalatRpc | null;
  try {
    ({ error } = await supabase.rpc('daftarkan_sesi'));
  } catch {
    return { status: 'gagal', kode: 'lainnya' };
  }
  if (!error) return { status: 'terdaftar' };
  const pesan = typeof error.message === 'string' ? error.message : '';
  if (pesan.includes('SESI_TANPA_KLAIM')) return { status: 'gagal', kode: 'tanpa_klaim' };
  if (pesan.includes('FORBIDDEN')) return { status: 'bukan_staf' };
  return { status: 'gagal', kode: 'lainnya' };
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

export type HasilPing =
  | { jenis: 'valid'; status: string; tutup: boolean }
  | { jenis: 'tidak_valid'; alasan: AlasanSesi }
  /** Bentuk tak dikenal: perlakukan seperti kegagalan jaringan (jangan logout). */
  | { jenis: 'tak_dikenal' };

/** Urai balasan `ping_sesi` (jsonb). Defensif: bentuk di luar kontrak -> 'tak_dikenal'. */
export function uraiHasilPing(data: unknown): HasilPing {
  if (typeof data !== 'object' || data === null) return { jenis: 'tak_dikenal' };
  const d = data as Record<string, unknown>;
  if (d.valid === true) {
    return { jenis: 'valid', status: typeof d.status === 'string' ? d.status : 'ok', tutup: d.tutup === true };
  }
  if (d.valid === false) {
    const alasan = parseAlasanSesi(typeof d.alasan === 'string' ? d.alasan : typeof d.status === 'string' ? d.status : null);
    return alasan ? { jenis: 'tidak_valid', alasan } : { jenis: 'tak_dikenal' };
  }
  return { jenis: 'tak_dikenal' };
}

// ---------------------------------------------------------------------------
// Keluar
// ---------------------------------------------------------------------------

/**
 * Logout staf yang sopan: `akhiri_sesi` dulu (menghapus baris sesi HANYA bila milik sesi ini), lalu
 * signOut. Kegagalan `akhiri_sesi` TIDAK menghalangi signOut.
 *
 * signOut memakai scope 'local' (hanya sesi ini). Scope bawaan 'global' mencabut SEMUA sesi pengguna,
 * sehingga perangkat lama yang baru dinyatakan 'digantikan' akan ikut mematikan sesi perangkat BARU.
 */
export async function keluarDariSesi(
  supabase: Pick<SupabaseClient, 'rpc'> & { auth: Pick<SupabaseClient['auth'], 'signOut'> },
  opsi: { akhiri?: boolean } = {},
): Promise<void> {
  if (opsi.akhiri !== false) {
    try {
      const { error } = await supabase.rpc('akhiri_sesi');
      // Sengaja diabaikan: baris sesi tanpa heartbeat berakhir sendiri lewat idle; logout tetap lanjut.
      void error;
    } catch {
      // jaringan putus / fungsi belum ada: logout tetap lanjut.
    }
  }
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // Sesi lokal tetap dibersihkan oleh navigasi keras pemanggil.
  }
}
