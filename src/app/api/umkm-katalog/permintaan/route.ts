import { cursorOpaqueSchema, queryInput } from '@/lib/umkm-katalog/schemas-g2';
import { ajukanSchema } from '@/lib/umkm-katalog/schemas-g4';
import { bacaJson, layaniRpc } from '@/lib/umkm-katalog/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return layaniRpc(cursorOpaqueSchema, async () => queryInput(request),
    'umkm_permintaan_saya', b => ({ p_cursor: b.cursor ?? null }));
}
export async function POST(request: Request) {
  return layaniRpc(ajukanSchema, () => bacaJson(request), 'umkm_ajukan_kontak', b => ({
    p_kebutuhan_id: b.kebutuhan_id, p_profil_ids: b.profil_ids, p_operasi_id: b.operasi_id,
  }));
}
