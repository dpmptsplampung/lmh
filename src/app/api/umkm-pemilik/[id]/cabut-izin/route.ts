import { aksiKlaimSchema } from '@/lib/umkm-katalog/schemas-g5';
import { inputAksi, layaniRpc, type IdContext } from '@/lib/umkm-katalog/server';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: IdContext) {
  return layaniRpc(aksiKlaimSchema, () => inputAksi(request, context), 'umkm_cabut_izin_pemilik', b => ({
    p_profil_id: b.id, p_expected_version: b.expected_version, p_operasi_id: b.operasi_id,
  }));
}
