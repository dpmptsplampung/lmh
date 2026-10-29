import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { muatStafRekap, paramsDariRequest } from '@/lib/rekap/akses';
import { muatDataSurvei } from '@/lib/survei/export';
import { responseRateGabungan, type ResponseRateBaris } from '@/lib/survei/laporan';
import { periodeSchema } from '@/lib/survei/periode';
import { hitungIkmGlobal, hitungSpakGlobal, type BarisMentah } from '@/lib/survei/ringkasan-global';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Ringkasan GLOBAL SPAK dan IKM (seluruh pelayanan digabung, tanpa pemecahan per Layanan) untuk dashboard "Hasil Survei".
// Hanya Admin dan Front Office. Jawaban dibaca lewat klien SESI pengguna (RLS), response rate lewat RPC yang dijaga peran_saya().
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const staf = await muatStafRekap(supabase);
  if (!staf.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (staf.me.role !== 'admin' && staf.me.role !== 'front_office') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const parsed = periodeSchema.safeParse(paramsDariRequest(request));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const { dari, sampai } = parsed.data;

  try {
    const [data, rate] = await Promise.all([
      muatDataSurvei(supabase, { dari, sampai }),
      supabase.rpc('ringkasan_response_rate', { p_start: dari, p_end: sampai }),
    ]);
    if (rate.error) throw rate.error;
    const periode = { dari, sampai };
    return NextResponse.json(
      {
        dari,
        sampai,
        spak: hitungSpakGlobal(data.spak as unknown as BarisMentah[], periode),
        ikm: hitungIkmGlobal(data.skm as unknown as BarisMentah[], periode),
        responseRate: responseRateGabungan((rate.data ?? []) as ResponseRateBaris[]),
        terpotong: data.terpotong,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[api/admin/survei/ringkasan] gagal memuat data survei:', error);
    return NextResponse.json({ error: 'Gagal memuat data survei' }, { status: 500 });
  }
}
