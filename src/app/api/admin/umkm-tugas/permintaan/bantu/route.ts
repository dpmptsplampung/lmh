import { bantuanSchema } from '@/lib/umkm-katalog/schemas-g4';
import { bacaJson, layaniRpc } from '@/lib/umkm-katalog/server';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return layaniRpc(bantuanSchema, () => bacaJson(request), 'umkm_bantu_permintaan', b => ({
    p_nama_perusahaan: b.nama_perusahaan, p_jabatan: b.jabatan, p_nama_pemohon: b.nama_pemohon,
    p_kontak: b.kontak, p_teks: b.teks, p_kategori: b.kategori, p_kabupaten_kota: b.kabupaten_kota ?? null,
    p_profil_id: b.profil_id, p_operasi_id: b.operasi_id,
  }));
}
