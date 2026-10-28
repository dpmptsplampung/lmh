import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getServiceClient } from '@/lib/akun/server';
import { muatStafRekap, paramsDariRequest } from '@/lib/rekap/akses';
import {
  buildSurveiWorkbook,
  muatDataSurvei,
  type RingkasanIkmRow,
  type RingkasanRateRow,
  type RingkasanSpakRow,
} from '@/lib/survei/export';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// Tanggal kalender nyata (2026-02-31 ditolak), bukan sekadar pola YYYY-MM-DD.
const tanggalSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Tanggal tidak valid');

const querySchema = z
  .object({ dari: tanggalSchema, sampai: tanggalSchema })
  .refine((v) => v.dari <= v.sampai, { message: 'dari harus sebelum atau sama dengan sampai', path: ['sampai'] });

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

  const parsed = querySchema.safeParse(paramsDariRequest(request));
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
    const [data, ikm, spak, rate] = await Promise.all([
      muatDataSurvei(supabase, { dari, sampai }),
      supabase.rpc('ringkasan_ikm', args),
      supabase.rpc('ringkasan_spak', args),
      supabase.rpc('ringkasan_response_rate', args),
    ]);
    for (const hasil of [ikm, spak, rate]) {
      if (hasil.error) throw hasil.error;
    }
    buf = await buildSurveiWorkbook({
      dari,
      sampai,
      spak: data.spak,
      skm: data.skm,
      ringkasanIkm: (ikm.data ?? []) as RingkasanIkmRow[],
      ringkasanSpak: (spak.data ?? []) as RingkasanSpakRow[],
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
