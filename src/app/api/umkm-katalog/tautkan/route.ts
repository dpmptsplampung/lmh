import { tautkanAkun } from '@/lib/umkm-katalog/permintaan-server';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) { return tautkanAkun(request); }
