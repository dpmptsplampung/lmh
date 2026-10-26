// Bagian server rekap terpadu yang dipakai route halaman dan route ekspor: identitas lingkup + pemetaan galat RPC.
// SELALU klien pengguna (createClient server), BUKAN service-role: RPC SECURITY DEFINER membaca auth.uid() pemanggil
// dan menegakkan lingkup §6.1 sendiri (migrasi 202610290002).
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { KODE_MIGRASI_BELUM, objekBelumAda } from '@/lib/akses-data/galat';
import type { LingkupData } from '@/lib/akses-data/lingkup';

export type HasilLingkup =
  | { ok: true; userId: string; lingkup: LingkupData }
  | { ok: false; res: NextResponse };

export const PESAN_MIGRASI_REKAP =
  'Rekap terpadu belum tersedia: migrasi 202610290001 dan 202610290002 belum diterapkan.';

/** Respons untuk galat RPC rekap: 409 bila migrasi belum ada, 422 untuk validasi DB, selain itu 500. */
export function responsGalatRekap(error: unknown, label: string): NextResponse {
  if (objekBelumAda(error)) {
    return NextResponse.json({ error: PESAN_MIGRASI_REKAP, kode: KODE_MIGRASI_BELUM }, { status: 409 });
  }
  const pesan = String((error as { message?: unknown } | null)?.message ?? '');
  const kode = /^(RENTANG_TIDAK_VALID|UNIT_TIDAK_VALID)/.exec(pesan)?.[1];
  if (kode) {
    return NextResponse.json({ error: pesan.replace(/^[A-Z_]+:\s*/, ''), kode }, { status: 422 });
  }
  console.error(`[${label}] gagal memuat rekap:`, error);
  return NextResponse.json({ error: 'Gagal memuat rekap' }, { status: 500 });
}

/** 401 bila belum masuk / bukan staf aktif; 409 bila migrasi belum diterapkan. */
export async function muatLingkup(supabase: SupabaseClient, label: string): Promise<HasilLingkup> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const { data, error } = await supabase.rpc('lingkup_data_saya');
  if (error) return { ok: false, res: responsGalatRekap(error, label) };
  const l = data as LingkupData | null;
  if (!l || !l.petugas_id) return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  return { ok: true, userId: user.id, lingkup: { ...l, koordinator: l.koordinator === true } };
}

export interface ArgRekap {
  p_dari: string;
  p_sampai: string;
  p_unit: string | null;
  p_layanan_id: string | null;
}

export function argRekap(q: { dari: string; sampai: string; unit?: string; layanan_id?: string }): ArgRekap {
  return { p_dari: q.dari, p_sampai: q.sampai, p_unit: q.unit ?? null, p_layanan_id: q.layanan_id ?? null };
}

/** Batas baris satu berkas Excel; satu panggilan RPC maksimal 1000 baris (dibatasi juga di DB). */
export const MAKS_BARIS_EKSPOR = 50_000;
export const HALAMAN_EKSPOR = 1000;

type BalasanData = { rows?: unknown; berikut?: unknown; total?: unknown };

/**
 * Semua baris Data Pelayanan untuk ekspor, paging KEYSET (`p_setelah` = kunci baris terakhir) sehingga tiap panggilan
 * hanya memproses satu halaman di DB. Tidak pernah memotong diam-diam: `truncated` true bila masih ada data di atas batas.
 */
export async function ambilSemuaDataPelayanan(
  supabase: SupabaseClient,
  arg: ArgRekap,
  maks = MAKS_BARIS_EKSPOR,
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const rows: Record<string, unknown>[] = [];
  let setelah: unknown = null;
  for (;;) {
    const { data, error } = await supabase.rpc('rekap_data_pelayanan', {
      ...arg, p_batas: HALAMAN_EKSPOR, p_lewati: 0, p_setelah: setelah, p_hitung: false,
    });
    if (error) throw error;
    const b = (data ?? {}) as BalasanData;
    const halaman = Array.isArray(b.rows) ? (b.rows as Record<string, unknown>[]) : [];
    rows.push(...halaman);
    if (rows.length > maks) return { rows: rows.slice(0, maks), truncated: true };
    if (!b.berikut || halaman.length === 0) return { rows, truncated: false };
    setelah = b.berikut;
  }
}

/** Jenis formulir Layanan terpilih (kolom formulir di Data Pelayanan); null bila tidak ada pilihan / tanpa formulir. */
export async function formLayanan(supabase: SupabaseClient, layananId: string | undefined): Promise<'oss' | 'perizinan' | null> {
  if (!layananId) return null;
  const { data, error } = await supabase.from('layanan').select('form_pendataan').eq('id', layananId).maybeSingle();
  if (error || !data) return null;
  const f = (data as { form_pendataan?: unknown }).form_pendataan;
  return f === 'oss' || f === 'perizinan' ? f : null;
}
