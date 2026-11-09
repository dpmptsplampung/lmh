import { catatHasil } from '@/lib/umkm-katalog/permintaan-server';
import type { IdContext } from '@/lib/umkm-katalog/server';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: IdContext) { return catatHasil(request, context); }
