import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getServiceClient } from '@/lib/akun/server';
import { muatStafRekap, paramsDariRequest } from '@/lib/rekap/akses';
import {
  buildSurveiWorkbook,
  muatDataSurvei,
  type RingkasanRateRow,
} from '@/lib/survei/export';
import { periodeSchema } from '@/lib/survei/periode';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// Unduhan hasil survei terpadu untuk Admin dan Front Office. Jawaban dibaca lewat klien SESI pengguna (RLS admin/FO).
// Ketiga RPC ringkasan dijaga peran_saya() dan mengembalikan HASIL KOSONG di bawah service role, jadi WAJIB dipanggil
// dengan klien sesi; klien layanan hanya dipakai menulis audit_log.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const staf = await muatStafRekap(supabase);
  if (!staf.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (staf.me.role !== 'admin' && staf.me.role !== 'front_office') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const parsed = periodeSchema.safeParse(paramsDariRequest(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const { dari, sampai } = parsed.data;

  let buf: Buffer;
  let jumlahSpak: number;
  let jumlahSkm: number;
  let terpotong: boolean;
  try {
    const args = { p_start: dari, p_end: sampai };
    const [data, rate] = await Promise.all([
      muatDataSurvei(supabase, { dari, sampai }),
      supabase.rpc('ringkasan_response_rate', args),
    ]);
    if (rate.error) throw rate.error;
    buf = await buildSurveiWorkbook({
      dari,
      sampai,
      spak: data.spak,
      skm: data.skm,
      ringkasanRate: (rate.data ?? []) as RingkasanRateRow[],
      terpotong: data.terpotong,
    });
    jumlahSpak = data.spak.length;
    jumlahSkm = data.skm.length;
    terpotong = data.terpotong;
  } catch (error) {
    console.error('[api/admin/survei/export] gagal memuat data survei:', error);
    return NextResponse.json({ error: 'Gagal memuat data survei' }, { status: 500 });
  }

  // audit_log hanya boleh ditulis server (service role); pengguna tidak punya INSERT langsung (S14).
  const { error: auditError } = (await getServiceClient()?.from('audit_log').insert({
    actor_id: staf.userId,
    actor_role: staf.me.role,
    aksi: 'export_xlsx',
    entitas: 'survei',
    detail: { dari, sampai, jumlah_spak: jumlahSpak, jumlah_skm: jumlahSkm, terpotong },
  })) ?? { error: { message: 'service client tidak tersedia' } };
  if (auditError) {
    console.error('[api/admin/survei/export] audit_log insert gagal:', auditError);
  }

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': contentDisposition(`survei-${dari}-sd-${sampai}.xlsx`),
      'Cache-Control': 'no-store',
      'X-Survei-Truncated': terpotong ? 'true' : 'false',
    },
  });
}
