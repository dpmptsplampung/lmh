import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { muatStafRekap, paramsDariRequest } from '@/lib/rekap/akses';
import { performaQuerySchema } from '@/lib/rekap/schemas';
import { fetchAllPages } from '@/lib/rekap/exportAll';
import { awalHariBerikutnyaWIB, awalHariWIB } from '@/lib/rekap/format';
import { hitungPerforma, type BarisPerforma } from '@/lib/rekap/performa';

export const dynamic = 'force-dynamic';

const KOLOM = 'id, kunjungan_id, peran_tahap, layanan_id, penangan_id, status, hasil, mulai_at, selesai_at, created_at';

// Performa pelayanan: hanya Admin. Agregasi di TypeScript dari baris penanganan (paginasi penuh, tanpa migrasi).
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const staf = await muatStafRekap(supabase);
  if (!staf.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (staf.me.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const parsed = performaQuerySchema.safeParse(paramsDariRequest(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
      { status: 422 },
    );
  }
  const { dari, sampai } = parsed.data;

  try {
    const { rows, truncated } = await fetchAllPages<BarisPerforma>((from, to) =>
      supabase
        .from('penanganan')
        .select(KOLOM)
        .gte('mulai_at', awalHariWIB(dari))
        .lt('mulai_at', awalHariBerikutnyaWIB(sampai))
        .order('mulai_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: BarisPerforma[] | null; error: unknown }>,
    );

    const [petugas, layanan] = await Promise.all([
      supabase.from('petugas').select('id, nama'),
      supabase.from('layanan').select('id, nama'),
    ]);
    if (petugas.error) throw petugas.error;
    if (layanan.error) throw layanan.error;
    const namaPetugas = Object.fromEntries((petugas.data ?? []).map((p: { id: string; nama: string }) => [p.id, p.nama]));
    const namaLayanan = Object.fromEntries((layanan.data ?? []).map((l: { id: string; nama: string }) => [l.id, l.nama]));

    return NextResponse.json({
      dari,
      sampai,
      truncated,
      ...hitungPerforma(rows, namaPetugas, namaLayanan),
    });
  } catch (error) {
    console.error('[api/admin/rekap/performa] gagal memuat performa:', error);
    return NextResponse.json({ error: 'Gagal memuat performa' }, { status: 500 });
  }
}
