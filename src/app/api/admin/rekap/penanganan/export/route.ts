import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getServiceClient } from '@/lib/akun/server';
import { muatStafRekap, paramsDariRequest } from '@/lib/rekap/akses';
import { penangananExportQuerySchema } from '@/lib/rekap/schemas';
import { fetchAllPages } from '@/lib/rekap/exportAll';
import { buildRekapPenangananWorkbook } from '@/lib/rekap/excelPenanganan';
import {
  buildPenangananQuery,
  mapRawPenangananRow,
  ringkasPenanganan,
  saringFo,
  tentukanCakupan,
} from '@/lib/rekap/penanganan';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// Ekspor Excel rekap penanganan. Paginasi PENUH (fetchAllPages): tidak terpotong oleh batas baris PostgREST; bila data
// melebihi 50.000 baris, berkas dipotong dan header X-Rekap-Truncated bernilai 'true' (audit T5).
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const staf = await muatStafRekap(supabase);
  if (!staf.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = penangananExportQuerySchema.safeParse(paramsDariRequest(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
      { status: 422 },
    );
  }
  const q = parsed.data;

  const cakupan = tentukanCakupan(staf.me, q);
  if (!cakupan.ok) return NextResponse.json({ error: cakupan.error }, { status: cakupan.status });

  let rows;
  let truncated = false;
  try {
    const hasil = await fetchAllPages((from, to) =>
      buildPenangananQuery(supabase, {
        peran: q.peran,
        dari: q.dari,
        sampai: q.sampai,
        penanganId: cakupan.penanganId,
        layananId: cakupan.layananId,
        from,
        to,
      }),
    );
    rows = saringFo(
      hasil.rows.map((r) => mapRawPenangananRow(r as unknown as Record<string, unknown>)),
      q.fo_id,
    );
    truncated = hasil.truncated;
  } catch (error) {
    console.error('[api/admin/rekap/penanganan/export] gagal memuat rekap:', error);
    return NextResponse.json({ error: 'Gagal memuat rekap' }, { status: 500 });
  }

  const buf = await buildRekapPenangananWorkbook(q.peran, rows, ringkasPenanganan(rows));

  // audit_log hanya boleh ditulis server (service role); pengguna tidak punya INSERT langsung (S14).
  const { error: auditError } = (await getServiceClient()?.from('audit_log').insert({
    actor_id: staf.userId,
    actor_role: staf.me.role,
    aksi: 'export_xlsx',
    entitas: q.peran === 'fo' ? 'rekap_penanganan_fo' : 'rekap_penanganan_layanan',
    detail: {
      peran: q.peran, dari: q.dari, sampai: q.sampai,
      petugas_id: cakupan.penanganId, fo_id: q.fo_id ?? null, layanan_id: cakupan.layananId,
      total_rows: rows.length, truncated,
    },
  })) ?? { error: { message: 'service client tidak tersedia' } };
  if (auditError) {
    console.error('[api/admin/rekap/penanganan/export] audit_log insert gagal:', auditError);
  }

  const filename = `rekap-${q.peran === 'fo' ? 'front-office' : 'petugas-layanan'}-${q.dari}-sd-${q.sampai}.xlsx`;
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': contentDisposition(filename),
      'Cache-Control': 'no-store',
      'X-Rekap-Truncated': truncated ? 'true' : 'false',
    },
  });
}
