// Pemetaan galat tulis/baca Pendataan Khusus -> respons HTTP (Fase 4). Dipakai route koleksi dan [fieldId].
import { NextResponse } from 'next/server';
import { KODE_MIGRASI_BELUM, objekBelumAda } from '@/lib/akses-data/galat';
import { kodeGalatKhusus, PESAN_GALAT_KHUSUS, type KodeGalatKhusus } from '@/lib/pendataan-khusus/galat';
import { MutasiError } from '@/lib/supabase/mutate';
import { catatMutasiGagal } from '@/app/api/admin/_mutasi';

export const PESAN_MIGRASI_KHUSUS =
  'Pendataan Khusus belum tersedia: migrasi 202610300001 belum diterapkan.';

const STATUS: Record<KodeGalatKhusus, number> = {
  KHUSUS_WAJIB: 422,
  KHUSUS_TIDAK_VALID: 422,
  KHUSUS_TIDAK_BERLAKU: 422,
  DATA_TIDAK_VALID: 422,
  JENIS_TERKUNCI: 409,
  SUDAH_DIISI: 409,
  LAYANAN_FORMULIR_TETAP: 409,
  OPSI_TIDAK_VALID: 422,
  ISIAN_TERLALU_BANYAK: 422,
  LAYANAN_TETAP: 422,
  ISIAN_TIDAK_DITEMUKAN: 404,
};

const headers = { 'Cache-Control': 'no-store' };

export function responsMigrasiKhusus(): NextResponse {
  return NextResponse.json({ error: PESAN_MIGRASI_KHUSUS, kode: KODE_MIGRASI_BELUM }, { status: 409, headers });
}

/** Galat objek Supabase `{code,message}` (hasil baca) atau MutasiError (hasil tulis) -> respons. */
export function responsGalatKhusus(e: unknown, route: string, operasi: string): NextResponse {
  const asal = e instanceof MutasiError ? e.asal : e;
  if (objekBelumAda(asal)) return responsMigrasiKhusus();
  const kode = kodeGalatKhusus(e);
  if (kode) return NextResponse.json({ error: PESAN_GALAT_KHUSUS[kode], kode }, { status: STATUS[kode], headers });
  if (e instanceof MutasiError && e.kode === 'tidak_ada_baris') {
    return NextResponse.json({ error: 'Isian tidak ditemukan' }, { status: 404, headers });
  }
  catatMutasiGagal(route, operasi, e);
  return NextResponse.json({ error: 'Gagal memproses Pendataan Khusus' }, { status: 500, headers });
}
