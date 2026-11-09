import { detailPekerjaan } from '@/lib/umkm-katalog/pekerjaan-server';
import type { IdContext } from '@/lib/umkm-katalog/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: IdContext) {
  return detailPekerjaan(request, context, 'pesan');
}
