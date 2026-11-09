import { cursorOpaqueSchema, queryInput } from '@/lib/umkm-katalog/schemas-g2';
import { layaniRpc } from '@/lib/umkm-katalog/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return layaniRpc(cursorOpaqueSchema, async () => queryInput(request), 'umkm_jejak_pengawasan',
    b => ({ p_cursor: b.cursor ?? null }));
}
