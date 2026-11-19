import { revalidateTag } from 'next/cache';
import { hapusGambar, ubahGambar } from '@/lib/data/investasi';
import { layaniKelola, type GambarContext } from '@/lib/investasi/akses-server';
import { hapusObjekGambar } from '@/lib/investasi/gambar-server';
import { bacaJson, galat, galatRpc, headersPrivat, sukses } from '@/lib/investasi/http';
import { gambarUbahSchema } from '@/lib/investasi/skema';
import { idSah } from '../../../server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;
export async function PATCH(request: Request, context: GambarContext) {
  return layaniKelola(async (sb, requestId) => {
    const { id, gambarId } = await context.params;
    const parsed = gambarUbahSchema.safeParse(await bacaJson(request));
    if (!idSah(id) || !idSah(gambarId) || !parsed.success) return galat('INPUT_TIDAK_VALID', requestId);
    const hasil = await ubahGambar(sb, id, gambarId, parsed.data);
    if (hasil.error) return galatRpc(hasil.error, requestId);
    if (!hasil.data) return galat('TIDAK_DITEMUKAN', requestId);
    revalidateTag('publik-investasi', { expire: 0 });
    return sukses(hasil.data);
  });
}
export async function DELETE(_request: Request, context: GambarContext) {
  return layaniKelola(async (sb, requestId) => {
    const { id, gambarId } = await context.params;
    if (!idSah(id) || !idSah(gambarId)) return galat('INPUT_TIDAK_VALID', requestId);
    const hasil = await hapusGambar(sb, id, gambarId);
    if (hasil.error) return galatRpc(hasil.error, requestId);
    if (!hasil.data) return galat('TIDAK_DITEMUKAN', requestId);
    await hapusObjekGambar([hasil.data.kunci, hasil.data.kunci_mini]);
    revalidateTag('publik-investasi', { expire: 0 });
    return new Response(null, { status: 204, headers: headersPrivat });
  });
}
