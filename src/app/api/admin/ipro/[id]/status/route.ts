import { revalidateTag } from 'next/cache';
import { ubahStatusIpro } from '@/lib/data/investasi';
import { layaniKelola, type IdContext } from '@/lib/investasi/akses-server';
import { bacaJson, galat, galatRpc, sukses } from '@/lib/investasi/http';
import { statusAksiSchema } from '@/lib/investasi/skema';
import { idSah } from '../../server';

export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: IdContext) {
  return layaniKelola(async (sb, requestId) => {
    const { id } = await context.params;
    const parsed = statusAksiSchema.safeParse(await bacaJson(request));
    if (!idSah(id) || !parsed.success) return galat('INPUT_TIDAK_VALID', requestId);
    const status = { terbit: 'terbit', arsip: 'arsip', kembali_draf: 'draf' }[parsed.data.aksi];
    const hasil = await ubahStatusIpro(sb, id, status, parsed.data.versi);
    if (hasil.error) return galatRpc(hasil.error, requestId);
    revalidateTag('publik-investasi', { expire: 0 });
    return sukses(hasil.data);
  });
}
