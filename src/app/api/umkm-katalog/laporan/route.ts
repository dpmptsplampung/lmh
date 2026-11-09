import { laporanSchema } from '@/lib/umkm-katalog/schemas-g2';
import { bacaJson, layaniRpc } from '@/lib/umkm-katalog/server';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return layaniRpc(laporanSchema, () => bacaJson(request), 'umkm_laporkan', b => ({
    p_profil_id: b.profil_id, p_alasan: b.alasan, p_operasi_id: b.operasi_id,
    p_foto_id: b.foto_id ?? null, p_catatan: b.catatan ?? null,
  }));
}
