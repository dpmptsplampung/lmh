import { detailPermintaan } from '@/lib/umkm-katalog/permintaan-server';
import type { IdContext } from '@/lib/umkm-katalog/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: IdContext) { return detailPermintaan(request, context); }
