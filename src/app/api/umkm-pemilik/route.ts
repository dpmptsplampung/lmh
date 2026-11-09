import { cursorOpaqueSchema, queryInput } from '@/lib/umkm-katalog/schemas-g2';
import { daftarUsahaSchema } from '@/lib/umkm-katalog/schemas-g5';
import { bacaJson, layaniRpc } from '@/lib/umkm-katalog/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return layaniRpc(cursorOpaqueSchema, async () => queryInput(request),
    'umkm_usaha_saya', b => ({ p_cursor: b.cursor ?? null }));
}
export async function POST(request: Request) {
  return layaniRpc(daftarUsahaSchema, () => bacaJson(request), 'umkm_daftar_usaha',
    b => ({ p_data: b.data, p_operasi_id: b.operasi_id }));
}
