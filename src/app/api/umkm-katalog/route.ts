import { katalogSchema, queryInput } from '@/lib/umkm-katalog/schemas-g2';
import { layaniPublik } from '@/lib/umkm-katalog/publik-server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const tanpaFilter = ['q', 'jenis', 'kategori', 'spesifik', 'kabupaten_kota', 'cursor']
    .every(key => !params.get(key)?.trim());
  return layaniPublik(katalogSchema, async () => queryInput(request), 'umkm_cari_katalog', b => ({
    p_q: b.q ?? null, p_jenis: b.jenis ?? null, p_kategori: b.kategori ?? null,
    p_spesifik: b.spesifik ?? null, p_kabupaten_kota: b.kabupaten_kota ?? null,
    p_sort: b.sort ?? 'terbaru', p_cursor: b.cursor ?? null,
  }), tanpaFilter);
}
