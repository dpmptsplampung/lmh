import { aksiPekerjaan } from '@/lib/umkm-katalog/pekerjaan-server';
import type { IdContext } from '@/lib/umkm-katalog/server';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: IdContext) {
  return aksiPekerjaan(request, context, 'laporan', 'ambil');
}
