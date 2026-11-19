import { kirimMinat } from '../pesan/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return kirimMinat(request, 'dokumen');
}
