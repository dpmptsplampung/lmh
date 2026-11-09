import { cursorSchema, simpanSchema } from '@/lib/umkm-katalog/schemas';
import { bacaJson, layaniRpc } from '@/lib/umkm-katalog/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return layaniRpc(cursorSchema, async () => Object.fromEntries(new URL(request.url).searchParams),
    'umkm_daftar_tugas', b => ({ p_cursor: b.cursor ?? null }));
}
export async function POST(request: Request) {
  return layaniRpc(simpanSchema, () => bacaJson(request), 'umkm_simpan_profil', b => ({
    p_data: b.data, p_operasi_id: b.operasi_id, p_profil_id: b.profil_id ?? null, p_expected_version: b.expected_version ?? null,
  }));
}
