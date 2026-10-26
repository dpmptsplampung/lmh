// Pemetaan galat database -> respons HTTP untuk tulis Layanan (POST/PATCH). Mengembalikan null bila bukan galat yang dikenal.
import { MutasiError } from '@/lib/supabase/mutate';
import { kodeDbMutasi, pesanDbMutasi } from '@/app/api/admin/_mutasi';
import { PESAN_PREFIKS } from '@/lib/layanan/schemas';

export type GalatHttp = { body: { error: string; kode: string }; status: number };

export function petaGalatTulisLayanan(e: MutasiError): GalatHttp | null {
  const kodeDb = kodeDbMutasi(e);
  const pesanDb = pesanDbMutasi(e);
  // 23505 = UNIQUE: prefiks (uq_layanan_prefiks_antrean) / slug (uq_layanan_slug) / selain itu nama.
  if (kodeDb === '23505') {
    if (/prefiks/i.test(pesanDb)) {
      return { status: 409, body: { error: 'Prefiks antrean sudah dipakai layanan lain. Pilih 2 huruf yang berbeda.', kode: 'PREFIKS_BENTROK' } };
    }
    if (/slug/i.test(pesanDb)) {
      return { status: 409, body: { error: 'Slug sudah dipakai layanan lain. Pilih slug yang berbeda.', kode: 'SLUG_BENTROK' } };
    }
    return { status: 409, body: { error: 'Nama layanan sudah dipakai layanan lain', kode: 'NAMA_BENTROK' } };
  }
  // 23514 = CHECK: format prefiks ditolak DB (lapis kedua di balik zod).
  if (kodeDb === '23514' && /prefiks/i.test(pesanDb)) {
    return { status: 422, body: { error: PESAN_PREFIKS, kode: 'PREFIKS_FORMAT' } };
  }
  // 23503 = FK: instansi_id tidak ada.
  if (kodeDb === '23503') {
    return { status: 422, body: { error: 'Instansi tidak ditemukan', kode: 'INSTANSI_TIDAK_ADA' } };
  }
  return null;
}

/**
 * Migrasi 202610280001 belum diterapkan: kolom layanan.tampil_di_homepage belum ada
 * (Postgres 42703 "column ... does not exist", atau PGRST204 "Could not find the ... column" dari PostgREST).
 * Route POST/PATCH mengulang tanpa kolom itu supaya Kelola Layanan tidak rusak sebelum migrasi diterapkan.
 */
export function kolomHomepageBelumAda(e: MutasiError): boolean {
  const kode = kodeDbMutasi(e);
  return (kode === '42703' || kode === 'PGRST204') && /tampil_di_homepage/i.test(pesanDbMutasi(e));
}
