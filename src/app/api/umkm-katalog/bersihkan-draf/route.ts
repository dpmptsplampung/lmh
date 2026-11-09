import { randomUUID, timingSafeEqual } from 'node:crypto';
import { bucketTerpisah, deleteObjects, listObjects, r2Tersedia } from '@/lib/storage/r2';
import { nowServer } from '@/lib/time';
import { penulisStatistik } from '@/lib/umkm-katalog/statistik-server';
import { galat, headersPrivat, kodeRpc } from '@/lib/umkm-katalog/server';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function cronSah(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get('authorization');
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`), actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  if (!cronSah(request)) return galat('LOGIN_DIPERLUKAN', requestId);
  const client = penulisStatistik();
  if (!client || !r2Tersedia() || !bucketTerpisah()) return galat('MODUL_BELUM_TERSEDIA', requestId);
  const mulai = nowServer().getTime(), tenggat = mulai + 45000, batasUmur = mulai - 30 * 86400000;
  const titikMulai = `umkm-draf/${randomUUID()}`;
  let dihapus = 0, selesai = false;
  try {
    pemindaian: for (const fase of [1, 2]) {
      let cursor: string | undefined;
      do {
        if (dihapus >= 1000 || nowServer().getTime() >= tenggat) break pemindaian;
        const page = await listObjects('private', 'umkm-draf/', cursor,
          fase === 1 && !cursor ? { startAfter: titikMulai } : undefined);
        const items = fase === 2 ? page.items.filter(o => o.key <= titikMulai) : page.items;
        const keys = items.filter(o => o.key.startsWith('umkm-draf/') && o.lastModified.getTime() < batasUmur)
          .map(o => o.key);
        if (keys.length) {
          const { data, error } = await client.rpc('umkm_draf_dilindungi', { p_keys: keys });
          if (error) return galat(kodeRpc(error), requestId);
          if (!Array.isArray(data?.dilindungi)) return galat('GAGAL_INTERNAL', requestId);
          const protectedKeys = new Set<string>(data.dilindungi);
          const yatim = keys.filter(k => !protectedKeys.has(k));
          const hapus = yatim.slice(0, 1000 - dihapus);
          if (hapus.length) {
            await deleteObjects('private', hapus);
            dihapus += hapus.length;
          }
          if (hapus.length < yatim.length) break pemindaian;
        }
        if (fase === 2 && (!page.nextCursor || page.items.some(o => o.key >= titikMulai))) {
          selesai = true;
          break pemindaian;
        }
        if (page.nextCursor && page.nextCursor === cursor) throw new Error('Halaman objek tidak berlanjut');
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
    }
    return Response.json({ data: { dihapus, selesai }, meta: { request_id: requestId } },
      { headers: headersPrivat });
  } catch { return galat('GAGAL_INTERNAL', requestId); }
}
