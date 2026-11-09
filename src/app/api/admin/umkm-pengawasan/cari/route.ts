import { cariPengawasanSchema, queryInput } from '@/lib/umkm-katalog/schemas-g2';
import { layaniRpc } from '@/lib/umkm-katalog/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return layaniRpc(cariPengawasanSchema, async () => queryInput(request), 'umkm_cari_pengawasan',
    b => ({ p_q: b.q, p_cursor: b.cursor ?? null }));
}
