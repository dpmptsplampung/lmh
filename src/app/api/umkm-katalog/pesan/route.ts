import { pesanSchema } from '@/lib/umkm-katalog/schemas-g2';
import { bacaJson, layaniRpc } from '@/lib/umkm-katalog/server';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return layaniRpc(pesanSchema, () => bacaJson(request), 'umkm_kirim_pesan_kontak', b => ({
    p_nama: b.nama, p_perusahaan: b.perusahaan, p_nomor: b.nomor, p_pesan: b.pesan,
    p_operasi_id: b.operasi_id, p_profil_id: b.profil_id ?? null, p_kata_kunci: b.kata_kunci ?? null,
  }));
}
