import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { pathTautan } from '@/lib/investasi/aset-halaman';
import { MAKS_HALAMAN_TERSAJI } from '@/lib/investasi/dokumen';
import { galat } from '@/lib/investasi/http';
import { buatPembatasLajuDokumen, ipPeminta } from '@/lib/investasi/laju-dokumen';
import { BERKAS_TAUTAN_KOSONG, BerkasTautanSchema, urlTautanAman } from '@/lib/investasi/tautan';
import { kunciObjek } from '@/lib/storage/area';
import { getObjectBytes } from '@/lib/storage/r2';

const bolehMuat = buatPembatasLajuDokumen(60);
const headers = { 'Cache-Control': 'public, max-age=300, s-maxage=300' };

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  const id = z.uuid().safeParse(new URL(request.url).searchParams.get('doc_id')?.toLowerCase());
  if (!id.success) return galat('INPUT_TIDAK_VALID', requestId);
  if (!bolehMuat(ipPeminta(request))) return galat('TERLALU_BANYAK', requestId);

  try {
    // Respons publik selalu memakai akses anon tanpa cookie dan memeriksa status di origin.
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
    });
    const { data: doc, error } = await client.from('investment_documents')
      .select('status, jumlah_halaman').eq('id', id.data).eq('status', 'aktif').maybeSingle();
    if (error) return galat('GAGAL_INTERNAL', requestId);
    if (doc?.status !== 'aktif') return galat('TIDAK_DITEMUKAN', requestId);

    const bytes = await getObjectBytes('private', kunciObjek('investment-docs', pathTautan(id.data)));
    if (!bytes) return Response.json(BERKAS_TAUTAN_KOSONG, { headers });

    const berkas = BerkasTautanSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    const batas = Math.min(doc.jumlah_halaman ?? 0, MAKS_HALAMAN_TERSAJI);
    const sah = berkas.tautan.every(({ hal, ke, url, x, y, w, h }) =>
      hal <= batas && w > 0 && h > 0 && x + w <= 1 + Number.EPSILON && y + h <= 1 + Number.EPSILON
      && (ke === undefined ? Boolean(urlTautanAman(url)) : ke <= batas && url === undefined));
    if (!sah) return galat('GAGAL_INTERNAL', requestId);
    return Response.json(berkas, { headers });
  } catch {
    return galat('GAGAL_INTERNAL', requestId);
  }
}
