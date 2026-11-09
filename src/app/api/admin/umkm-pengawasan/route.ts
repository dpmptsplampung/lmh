import { kosongSchema, queryInput } from '@/lib/umkm-katalog/schemas-g2';
import { layaniRpc } from '@/lib/umkm-katalog/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return layaniRpc(kosongSchema, async () => queryInput(request), 'umkm_ringkasan_pengawasan', () => ({}));
}
