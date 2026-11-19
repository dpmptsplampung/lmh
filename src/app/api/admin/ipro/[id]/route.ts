import { revalidateTag } from 'next/cache';
import { hapusIpro, iproKelolaById, ubahIpro } from '@/lib/data/investasi';
import { layaniKelola, type IdContext } from '@/lib/investasi/akses-server';
import { hapusObjekGambar } from '@/lib/investasi/gambar-server';
import { bacaJson, galat, headersPrivat, kodeRpc, sukses } from '@/lib/investasi/http';
import { iproUbahSchema } from '@/lib/investasi/skema';
import { idSah, kekuranganTerbit, perubahanSah } from '../server';

export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: IdContext) {
  return layaniKelola(async (sb, requestId) => {
    const { id } = await context.params;
    if (!idSah(id)) return galat('INPUT_TIDAK_VALID', requestId);
    const hasil = await iproKelolaById(sb, id);
    if (hasil.error) return galat(kodeRpc(hasil.error), requestId);
    return hasil.data ? sukses(hasil.data) : galat('TIDAK_DITEMUKAN', requestId);
  });
}
export async function PATCH(request: Request, context: IdContext) {
  return layaniKelola(async (sb, requestId) => {
    const { id } = await context.params;
    const parsed = iproUbahSchema.safeParse(await bacaJson(request));
    if (!idSah(id) || !parsed.success) return galat('INPUT_TIDAK_VALID', requestId);
    const lama = await iproKelolaById(sb, id);
    if (lama.error) return galat(kodeRpc(lama.error), requestId);
    if (!lama.data) return galat('TIDAK_DITEMUKAN', requestId);
    if (lama.data.versi !== parsed.data.versi) return galat('KONFLIK_VERSI', requestId);
    const { versi: _versi, ...perubahan } = parsed.data;
    if (!perubahanSah(lama.data, perubahan)) return galat('INPUT_TIDAK_VALID', requestId);
    if (lama.data.status === 'terbit') {
      const kurang = kekuranganTerbit({ ...lama.data, ...perubahan }, lama.data.gambar);
      if (kurang.length) return galat('SYARAT_TERBIT', requestId, kurang);
    }
    const hasil = await ubahIpro(sb, id, parsed.data);
    if (hasil.error) return galat(kodeRpc(hasil.error), requestId);
    revalidateTag('publik-investasi', { expire: 0 });
    return sukses(hasil.data);
  });
}
export async function DELETE(_request: Request, context: IdContext) {
  return layaniKelola(async (sb, requestId) => {
    const { id } = await context.params;
    if (!idSah(id)) return galat('INPUT_TIDAK_VALID', requestId);
    const lama = await iproKelolaById(sb, id);
    if (lama.error) return galat(kodeRpc(lama.error), requestId);
    if (!lama.data) return galat('TIDAK_DITEMUKAN', requestId);
    if (lama.data.status !== 'draf') return galat('KONFLIK_STATUS', requestId);
    const hasil = await hapusIpro(sb, id, lama.data.versi);
    if (hasil.error) return galat(kodeRpc(hasil.error), requestId);
    await hapusObjekGambar(lama.data.gambar.flatMap(g => [g.kunci, g.kunci_mini]));
    revalidateTag('publik-investasi', { expire: 0 });
    return new Response(null, { status: 204, headers: headersPrivat });
  });
}
