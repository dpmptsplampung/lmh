import { aksiPermintaan } from '@/lib/umkm-katalog/permintaan-server';
import type { IdContext } from '@/lib/umkm-katalog/server';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: IdContext) {
  return aksiPermintaan(request, context, 'setujui');
}
