import { cursorOpaqueSchema, queryInput } from '@/lib/umkm-katalog/schemas-g2';
import { kebutuhanSchema } from '@/lib/umkm-katalog/schemas-g4';
import { bacaJson, layaniRpc } from '@/lib/umkm-katalog/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return layaniRpc(cursorOpaqueSchema, async () => queryInput(request),
    'umkm_kebutuhan_saya', b => ({ p_cursor: b.cursor ?? null }));
}
export async function POST(request: Request) {
  return layaniRpc(kebutuhanSchema, () => bacaJson(request), 'umkm_simpan_kebutuhan', b => ({
    p_teks: b.teks, p_kategori: b.kategori, p_kabupaten_kota: b.kabupaten_kota ?? null, p_id: b.id ?? null,
  }));
}
