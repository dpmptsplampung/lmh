import { createClient } from '@supabase/supabase-js';
import { unstable_cache } from 'next/cache';
import type { z } from 'zod';
import { galat, headersPrivat, kodeRpc } from './server';
import type { DaftarKatalog, FilterKatalog, ProfilPublik } from './types';

export const TAG_KATALOG = 'umkm-katalog';
type Publik = {
  umkm_cari_katalog: { args: Record<string, string | null>; hasil: DaftarKatalog };
  umkm_filter_katalog: { args: Record<string, never>; hasil: FilterKatalog };
  umkm_profil_publik: { args: { p_profil_id: string }; hasil: ProfilPublik };
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
}, ['umkm-katalog-g2'], { tags: [TAG_KATALOG], revalidate: 60 });

export async function layaniPublik<S extends z.ZodType, K extends keyof Publik>(
  schema: S, input: () => Promise<unknown>, nama: K,
  args: (b: z.output<S>) => Publik[K]['args'], cache: boolean,
) {
  const requestId = crypto.randomUUID();
  try {
    const parsed = schema.safeParse(await input());
    if (!parsed.success) return galat('INPUT_TIDAK_VALID', requestId);
    const params = args(parsed.data);
    let data: Publik[keyof Publik]['hasil'];
    if (cache && nama !== 'umkm_profil_publik') {
      const hit = await bacaCache(nama, params);
      data = hit.kedaluwarsa > Date.now() ? hit.data : await bacaPublik(nama, params);
    } else data = await bacaPublik(nama, params);
    const cursor = 'next_cursor' in data ? data.next_cursor : undefined;
    return Response.json({ data, meta: { request_id: requestId,
      ...(cursor !== undefined ? { next_cursor: cursor } : {}) } }, { headers: headersPrivat });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'GAGAL_INTERNAL';
    const codes = ['INPUT_TIDAK_VALID', 'TIDAK_DITEMUKAN', 'MODUL_BELUM_TERSEDIA', 'GAGAL_INTERNAL'];
    return galat(codes.includes(code) ? code : 'GAGAL_INTERNAL', requestId);
  }
}
