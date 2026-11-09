import { cariSchema } from '@/lib/umkm-katalog/schemas';
import { layaniRpc } from '@/lib/umkm-katalog/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return layaniRpc(cariSchema, async () => Object.fromEntries(new URL(request.url).searchParams),
    'umkm_cari_profil', b => ({ p_q: b.q, p_cursor: b.cursor ?? null }));
}
