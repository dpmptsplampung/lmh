import { after } from 'next/server';
import { katalogSchema, queryInput } from '@/lib/umkm-katalog/schemas-g2';
import { layaniPublik } from '@/lib/umkm-katalog/publik-server';
import { catatTanpaHasil } from '@/lib/umkm-katalog/statistik-server';
import { buatPengukur } from '@/lib/observability/durasi';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  // Jalur ber-cache: tanpa q, spesifik, cursor. Tidak membaca cookie/sesi.
  const bisaCache = ['q', 'spesifik', 'cursor'].every(key => !params.get(key)?.trim());
  const pengukur = buatPengukur();
  const response = await pengukur.ukur('katalog', () => layaniPublik(katalogSchema, async () => queryInput(request), 'umkm_cari_katalog', b => ({
    p_q: b.q ?? null, p_jenis: b.jenis ?? null, p_kategori: b.kategori ?? null,
    p_spesifik: b.spesifik ?? null, p_kabupaten_kota: b.kabupaten_kota ?? null,
    p_sort: b.sort ?? 'paling_sesuai', p_cursor: b.cursor ?? null,
  }), bisaCache, { headerSukses: { 'Cache-Control': 'public, s-maxage=60' } }));
  if (response.ok && !params.get('cursor')) {
    const salinan = response.clone();
    const kategori = params.get('kategori');
    const kabupaten = params.get('kabupaten_kota');
    after(async () => {
      try {
        const hasil = await salinan.json();
        if (hasil.data.items.length === 0) await catatTanpaHasil(request, kategori, kabupaten);
      } catch { /* statistik tidak boleh mengganggu respons */ }
    });
  }
  if (response.ok) {
    const headers = new Headers(response.headers);
    headers.set('Server-Timing', pengukur.header());
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  return response;
}
