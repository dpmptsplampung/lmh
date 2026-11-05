// Pembantu bersama rute aksi pengaduan (tangani, ambil alih, linimasa): hanya Admin dan Front Office aktif.
// Jalur integritas = Admin saja; itu dijaga RPC (42501) dan RLS, bukan hanya di sini.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerEvent } from '@/lib/observability/logger';
import { objekBelumAda } from '@/lib/akses-data/galat';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Klien = Awaited<ReturnType<typeof createClient>>;

export async function aktorTinjau(): Promise<{ supabase: Klien } | { galat: NextResponse }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { galat: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const { data: me } = await supabase.from('petugas').select('role, aktif').eq('auth_user_id', user.id).maybeSingle();
  if (!me || me.aktif === false || (me.role !== 'admin' && me.role !== 'front_office')) {
    return { galat: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { supabase };
}

interface GalatRpc { code?: string; message?: string; details?: string | null }

/** Memetakan galat RPC pengaduan ke respons HTTP. `operasi` dipakai untuk log; PII tidak dicatat. */
export function jawabGalatRpc(error: GalatRpc, operasi: string, route: string): NextResponse {
  if (objekBelumAda(error)) {
    return NextResponse.json({ error: 'Fitur ini belum aktif karena pembaruan basis data belum diterapkan.', kode: 'MIGRASI_BELUM_DITERAPKAN' }, { status: 409 });
  }
  if (error.code === '42501') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (error.code === 'P0002') return NextResponse.json({ error: 'Pengaduan tidak ditemukan' }, { status: 404 });
  const pesan = `${error.message ?? ''}`;
  if (error.code === '22023' || pesan.startsWith('ALASAN_WAJIB') || pesan.startsWith('MASUKAN_TIDAK_VALID')) {
    return NextResponse.json({ error: 'Alasan wajib diisi, 5 sampai 500 karakter.' }, { status: 400 });
  }
  if (pesan.includes('PENANGAN_KOSONG')) {
    return NextResponse.json({ error: 'Pengaduan ini belum ada penangannya. Tekan Tangani.', kode: 'PENANGAN_KOSONG' }, { status: 409 });
  }
  if (pesan.includes('PENANGAN_SUDAH_ADA')) {
    return NextResponse.json({ error: 'Pengaduan ini sudah ditangani orang lain.', kode: 'PENANGAN_SUDAH_ADA', penangan_nama: error.details ?? null }, { status: 409 });
  }
  if (pesan.includes('PENGADUAN_DITUTUP')) {
    return NextResponse.json({ error: 'Pengaduan ini sudah ditutup.', kode: 'PENGADUAN_DITUTUP' }, { status: 409 });
  }
  logServerEvent('error', { operation: operasi, route, error });
  return NextResponse.json({ error: 'Gagal memproses permintaan' }, { status: 500 });
}
