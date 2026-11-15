import { createClient } from '@supabase/supabase-js';
import { unstable_cache } from 'next/cache';
import type { z } from 'zod';
import { galat, headersPrivat, kodeRpc } from './server';
import { invalidasiKatalog } from './foto-server';
import type { DaftarKatalog, FilterKatalog, ProfilPublik, Kartu } from './types';

export const TAG_KATALOG = 'umkm-katalog';
type Publik = {
  umkm_cari_katalog: { args: Record<string, string | null>; hasil: DaftarKatalog };
  umkm_filter_katalog: { args: Record<string, never>; hasil: FilterKatalog };
  umkm_profil_publik: { args: { p_profil_id: string }; hasil: ProfilPublik };
  umkm_serupa: { args: { p_profil_id: string }; hasil: { items: Kartu[] } };
};
async function bacaPublik<K extends keyof Publik>(nama: K, args: Publik[K]['args']) {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });
  const { data, error } = await client.rpc(nama, args);
  if (error) throw new Error(kodeRpc(error));
  if (data === null) throw new Error('TIDAK_DITEMUKAN');
  return data as Publik[K]['hasil'];
}
const bacaCache = unstable_cache(async (
  nama: 'umkm_cari_katalog' | 'umkm_filter_katalog', args: Record<string, string | null>,
) => {
  const data = await bacaPublik(nama, args as Record<string, never>);
  return { data, kedaluwarsa: Date.now() + 60000 };
}, ['umkm-katalog-g3'], { tags: [TAG_KATALOG], revalidate: 60 });

export async function layaniPublik<S extends z.ZodType, K extends keyof Publik>(
  schema: S, input: () => Promise<unknown>, nama: K,
  args: (b: z.output<S>) => Publik[K]['args'], cache: boolean,
  opsi: { headerSukses?: HeadersInit } = {},
) {
  const requestId = crypto.randomUUID();
  try {
    const parsed = schema.safeParse(await input());
    if (!parsed.success) return galat('INPUT_TIDAK_VALID', requestId);
    const params = args(parsed.data);
    let data: Publik[keyof Publik]['hasil'];
    if (cache && (nama === 'umkm_cari_katalog' || nama === 'umkm_filter_katalog')) {
      const hit = await bacaCache(nama, params);
      data = hit.kedaluwarsa > Date.now() ? hit.data : await bacaPublik(nama, params);
    } else data = await bacaPublik(nama, params);
    const cursor = 'next_cursor' in data ? data.next_cursor : undefined;
    // Header publik hanya untuk jalur ber-cache yang berisi data; selain itu tetap privat.
    const items = 'items' in data ? data.items : undefined;
    const headers = cache && opsi.headerSukses && Array.isArray(items) && items.length > 0
      ? opsi.headerSukses : headersPrivat;
    return Response.json({ data, meta: { request_id: requestId,
      ...(cursor !== undefined ? { next_cursor: cursor } : {}) } }, { headers });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'GAGAL_INTERNAL';
    if (code === 'SNAPSHOT_BERUBAH') invalidasiKatalog();
    const codes = ['INPUT_TIDAK_VALID', 'TIDAK_DITEMUKAN', 'MODUL_BELUM_TERSEDIA',
      'GAGAL_INTERNAL', 'SNAPSHOT_BERUBAH'];
    return galat(codes.includes(code) ? code : 'GAGAL_INTERNAL', requestId);
  }
}
