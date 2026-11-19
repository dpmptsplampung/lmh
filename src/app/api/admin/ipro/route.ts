import { revalidateTag } from 'next/cache';
import { buatIpro, daftarIproKelola } from '@/lib/data/investasi';
import { layaniKelola } from '@/lib/investasi/akses-server';
import { bacaJson, galat, kodeRpc, sukses, headersPrivat } from '@/lib/investasi/http';
import { daftarIproSchema, iproBuatSchema } from '@/lib/investasi/skema';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return layaniKelola(async (sb, requestId) => {
    const parsed = daftarIproSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return galat('INPUT_TIDAK_VALID', requestId);
    const hasil = await daftarIproKelola(sb, parsed.data);
    if (hasil.error) return galat(kodeRpc(hasil.error), requestId);
    return Response.json({ data: hasil.data, count: hasil.count }, { headers: headersPrivat });
  });
}
export async function POST(request: Request) {
  return layaniKelola(async (sb, requestId) => {
    const parsed = iproBuatSchema.safeParse(await bacaJson(request));
    if (!parsed.success) return galat('INPUT_TIDAK_VALID', requestId);
    const hasil = await buatIpro(sb, parsed.data);
    if (hasil.error) return galat(kodeRpc(hasil.error), requestId);
    revalidateTag('publik-investasi', { expire: 0 });
    return sukses(hasil.data, 201);
  });
}
