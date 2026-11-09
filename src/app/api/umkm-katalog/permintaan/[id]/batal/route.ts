import { idSchema, inputAksi, layaniRpc, type IdContext } from '@/lib/umkm-katalog/server';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: IdContext) {
  return layaniRpc(idSchema, async () => inputAksi(request, context), 'umkm_batalkan_permintaan',
    b => ({ p_id: b.id }));
}
