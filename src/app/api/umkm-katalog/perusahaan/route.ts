import { perusahaanSaya } from '@/lib/umkm-katalog/permintaan-server';
import { perusahaanSchema } from '@/lib/umkm-katalog/schemas-g4';
import { bacaJson, layaniRpc } from '@/lib/umkm-katalog/server';
export const dynamic = 'force-dynamic';
export async function GET() { return perusahaanSaya(); }
export async function POST(request: Request) {
  return layaniRpc(perusahaanSchema, () => bacaJson(request), 'umkm_simpan_perusahaan', b => ({
    p_nama: b.nama, p_jabatan: b.jabatan, p_setuju: b.setuju,
  }));
}
