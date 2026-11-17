import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { json, requireStaf } from '@/lib/akun/server';
import { todayWIB } from '@/lib/time';
import { fetchAllPages } from '@/lib/rekap/exportAll';
import { jumlahHariRentang, MAKS_RENTANG_HARI } from '@/lib/rekap/schemas';

export const KOLOM_TAMU = 'id, nama, asal, no_hp, menemui_siapa, keperluan, waktu_masuk, waktu_keluar, menemui_petugas_id, dicatat_oleh, pencatat:petugas!dicatat_oleh(nama), ditemui:petugas!menemui_petugas_id(nama)';
export type BarisTamu = {
  id: string; nama: string; asal: string | null; no_hp: string | null; menemui_siapa: string;
  keperluan: string | null; waktu_masuk: string; waktu_keluar: string | null; menemui_petugas_id: string | null;
  dicatat_oleh: string | null; pencatat?: { nama: string | null } | null; ditemui?: { nama: string | null } | null;
};
export const petaTamu = (r: BarisTamu) => ({
  id: r.id, nama: r.nama, instansi: r.asal, no_hp: r.no_hp, bertemu: r.ditemui?.nama ?? r.menemui_siapa,
  tujuan: r.keperluan, waktu_masuk: r.waktu_masuk, waktu_keluar: r.waktu_keluar,
  menemui_petugas_id: r.menemui_petugas_id, dicatat_oleh: r.dicatat_oleh, dicatat_nama: r.pencatat?.nama ?? null,
});
const rentang = {
  dari: z.iso.date().optional(), sampai: z.iso.date().optional(), q: z.string().trim().max(100).optional(),
};
const validRentang = (v: { dari?: string; sampai?: string }) => {
  const dari = v.dari ?? todayWIB();
  const sampai = v.sampai ?? dari;
  return sampai >= dari && jumlahHariRentang(dari, sampai) <= MAKS_RENTANG_HARI;
};
export const queryTamu = z.object({ ...rentang,
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict().refine(validRentang, { message: `Rentang tanggal tidak valid, maksimum ${MAKS_RENTANG_HARI} hari`, path: ['sampai'] });
export const queryEksporTamu = z.object({ ...rentang, format: z.enum(['xlsx', 'csv']).default('xlsx') })
  .strict().refine(validRentang, { message: `Rentang tanggal tidak valid, maksimum ${MAKS_RENTANG_HARI} hari`, path: ['sampai'] });
export type FilterTamu = { dari?: string; sampai?: string; q?: string };
export function tanggalTamu(q: FilterTamu) {
  const dari = q.dari ?? todayWIB();
  return { dari, sampai: q.sampai ?? dari };
}

export async function guardTamu() {
  const g = await requireStaf();
  if ('res' in g) return g;
  if (g.me.role !== 'admin' && g.me.role !== 'front_office') return { res: json({ error: 'Forbidden' }, 403) };
  return g;
}

/** RLS klien pengguna menegakkan admin/FO; tanggal dan urutan identik pada daftar dan ekspor. */
export function kueriTamu(supabase: SupabaseClient, q: FilterTamu, hitung = false) {
  const { dari, sampai } = tanggalTamu(q);
  let qb = supabase.from('buku_tamu').select(KOLOM_TAMU, hitung ? { count: 'exact' } : undefined)
    .gte('waktu_masuk', `${dari}T00:00:00+07:00`)
    .lte('waktu_masuk', `${sampai}T23:59:59.999999+07:00`)
    .order('waktu_masuk', { ascending: false }).order('id', { ascending: false });
  if (q.q) {
    const s = q.q.replace(/[%_,()\\".]/g, ' ');
    qb = qb.or(`nama.ilike.%${s}%,asal.ilike.%${s}%,menemui_siapa.ilike.%${s}%`);
  }
  return qb;
}

export async function semuaTamu(supabase: SupabaseClient, q: FilterTamu, maks = 50_000) {
  return fetchAllPages<BarisTamu>(async (from, to) => {
    const { data, error } = await kueriTamu(supabase, q).range(from, to);
    return { data: data as unknown as BarisTamu[] | null, error };
  }, maks);
}
