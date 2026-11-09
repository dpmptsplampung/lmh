import { z } from 'zod';
import { galat, headersPrivat, layaniRpc } from '@/lib/umkm-katalog/server';
import { kunciObjek } from '@/lib/storage/area';
import { presignGet, r2Tersedia } from '@/lib/storage/r2';
import type { ApiSukses, Detail } from '@/lib/umkm-katalog/types';
export const dynamic = 'force-dynamic';
const schema = z.object({ id: z.uuid(), fotoId: z.uuid() }).strict();
type Context = { params: Promise<{ id: string; fotoId: string }> };
export async function GET(_request: Request, context: Context) {
  const response = await layaniRpc(schema, () => context.params, 'umkm_detail_tugas', b => ({ p_profil_id: b.id }));
  if (!response.ok) return response;
  const { data, meta } = await response.json() as ApiSukses<Detail>;
  try {
    const { fotoId } = await context.params;
    const foto = data.foto.find(f => f.id === fotoId);
    if (!foto || foto.asal !== 'unggahan' || !foto.r2_key?.startsWith('umkm-draf/')) return galat('TIDAK_DITEMUKAN', meta.request_id);
    const key = kunciObjek('umkm-draf', foto.r2_key.slice('umkm-draf/'.length));
    const ekstensi = key.split('.').at(-1) ?? '';
    const mime: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
    if (!mime[ekstensi]) return galat('TIDAK_DITEMUKAN', meta.request_id);
    if (!r2Tersedia()) return galat('MODUL_BELUM_TERSEDIA', meta.request_id);
    const url = await presignGet('private', key, 60, { contentType: mime[ekstensi], contentDisposition: 'inline' });
    return new Response(null, { status: 307, headers: { ...headersPrivat, Location: url, 'Referrer-Policy': 'no-referrer' } });
  } catch { return galat('GAGAL_INTERNAL', meta.request_id); }
}
