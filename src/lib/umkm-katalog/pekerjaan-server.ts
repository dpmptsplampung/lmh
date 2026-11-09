import { z } from 'zod';
import { versiSchema } from './schemas';
import { queryInput } from './schemas-g2';
import { idSchema, inputAksi, layaniRpc, type IdContext } from './server';
const schema = versiSchema.extend({ id: z.uuid() });
export async function detailPekerjaan(request: Request, context: IdContext, jenis: 'pesan' | 'laporan') {
  return layaniRpc(idSchema, async () => ({ ...queryInput(request), ...(await context.params) }),
    jenis === 'pesan' ? 'umkm_detail_pesan' : 'umkm_detail_laporan', b => ({ p_id: b.id }));
}
export async function aksiPekerjaan(
  request: Request, context: IdContext, jenis: 'pesan' | 'laporan', aksi: 'ambil' | 'selesai',
) {
  return layaniRpc(schema, () => inputAksi(request, context),
    aksi === 'ambil' ? 'umkm_ambil_pekerjaan' : 'umkm_selesaikan_pekerjaan', b => ({
      p_jenis: jenis, p_id: b.id, p_expected_version: b.expected_version, p_operasi_id: b.operasi_id,
    }));
}
