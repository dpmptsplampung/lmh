import { kosongSchema, queryInput } from '@/lib/umkm-katalog/schemas-g2';
import { layaniPublik } from '@/lib/umkm-katalog/publik-server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return layaniPublik(kosongSchema, async () => queryInput(request), 'umkm_filter_katalog', () => ({}), true);
}
