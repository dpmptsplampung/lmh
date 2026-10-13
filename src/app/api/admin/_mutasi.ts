// Pembantu route admin untuk mutasi Supabase yang SELALU dicek (audit T2d, spec 2026-10-12-mutasi-tercek-design.md).
// Helper `mutasiWajibBaris`/`mutasiBolehKosong`/`mutasiInsert` murni (tanpa logger); route yang menangkap
// `MutasiError` mencatatnya lewat pencatat bersama `src/lib/observability/catat-mutasi.ts` (hanya `kode` + SQLSTATE,
// tanpa pesan teknis mentah). Berkas ini menambah pemetaan status HTTP dan akses pesan asli untuk pencocokan aturan.
import { MutasiError, type KodeMutasi } from '@/lib/supabase/mutate';
import { catatMutasi } from '@/lib/observability/catat-mutasi';

const STATUS_DEFAULT: Record<KodeMutasi, number> = {
  ditolak: 403,
  tidak_ada_baris: 404,
  jaringan: 503,
  database: 500,
};

/** Status HTTP untuk `MutasiError`; `peta` menimpa sebagian kode (mis. `tidak_ada_baris` -> 409 pada route tertentu). */
export function statusMutasi(e: MutasiError, peta: Partial<Record<KodeMutasi, number>> = {}): number {
  return peta[e.kode] ?? STATUS_DEFAULT[e.kode];
}

/** SQLSTATE/kode PostgREST dari error asli (`MutasiError.asal`), bila ada. */
export function kodeDbMutasi(e: unknown): string | undefined {
  const asal = e instanceof MutasiError ? e.asal : e;
  if (typeof asal === 'object' && asal !== null) {
    const kode = (asal as { code?: unknown }).code;
    if (typeof kode === 'string' && kode !== '') return kode;
  }
  return undefined;
}

/** Pesan asli dari error database (untuk pencocokan aturan trigger, mis. "Admin aktif terakhir"); JANGAN dicatat/ditampilkan. */
export function pesanDbMutasi(e: unknown): string {
  const asal = e instanceof MutasiError ? e.asal : e;
  if (typeof asal === 'object' && asal !== null) {
    const pesan = (asal as { message?: unknown }).message;
    if (typeof pesan === 'string') return pesan;
  }
  return '';
}

/**
 * Catat mutasi yang gagal (level error/warn -> juga ke tabel error_log lewat logger).
 * `tidak_ada_baris` (id basi / sudah dihapus, biasanya bukan kegagalan sistem) = warn;
 * `ditolak`/`database`/`jaringan` dan error tak dikenal = error (penolakan RLS di route server = kemungkinan salah konfigurasi).
 * `konteks` hanya boleh berisi id/penanda non-PII (logger menyamarkan kunci sensitif seperti name/email/token).
 */
export function catatMutasiGagal(route: string, operation: string, e: unknown, konteks: Record<string, unknown> = {}): void {
  const level = e instanceof MutasiError && e.kode === 'tidak_ada_baris' ? 'warn' : 'error';
  catatMutasi(level, operation, route, e, konteks);
}
