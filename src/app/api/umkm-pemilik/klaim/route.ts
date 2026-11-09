import { klaimSchema } from '@/lib/umkm-katalog/schemas-g5';
import { bacaJson, layaniRpc } from '@/lib/umkm-katalog/server';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return layaniRpc(klaimSchema, () => bacaJson(request), 'umkm_klaim_profil', b => ({
    p_profil_id: b.profil_id, p_alasan: b.alasan, p_operasi_id: b.operasi_id,
  }));
}
