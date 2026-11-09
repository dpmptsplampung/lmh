import { z } from 'zod';
import { bacaJson, layaniRpc } from '@/lib/umkm-katalog/server';
import { cursorOpaqueSchema, queryInput } from '@/lib/umkm-katalog/schemas-g2';
import { invalidasiKatalog } from '@/lib/umkm-katalog/foto-server';
export const dynamic = 'force-dynamic';
const sakelarSchema = z.object({
  aktif: z.boolean(), versi_naskah: z.string().trim().max(100), kebijakan_terbit: z.boolean(),
}).strict();
export async function GET(request: Request) {
  return layaniRpc(cursorOpaqueSchema, async () => queryInput(request), 'umkm_laporan_statistik',
    b => ({ p_cursor: b.cursor ?? null }));
}
export async function POST(request: Request) {
  return layaniRpc(sakelarSchema, () => bacaJson(request), 'umkm_atur_telemetri', b => ({
    p_aktif: b.aktif, p_versi_naskah: b.versi_naskah, p_kebijakan_terbit: b.kebijakan_terbit,
  }), async data => { invalidasiKatalog(); return data; });
}
