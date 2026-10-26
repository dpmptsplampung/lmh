import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getServiceClient } from '@/lib/akun/server';
import { paramsDariRequest } from '@/lib/rekap/akses';
import { labelLingkup } from '@/lib/akses-data/lingkup';
import { buildDataPelayananWorkbook } from '@/lib/rekap/excelTerpadu';
import { kolomDataPelayanan, NAMA_UNIT_FO, petaBarisPelayanan, rekapTerpaduExportSchema } from '@/lib/rekap/terpadu';
import { ambilSemuaDataPelayanan, argRekap, formLayanan, muatLingkup, responsGalatRekap } from '@/lib/rekap/terpaduServer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const LABEL = 'api/admin/rekap/terpadu/export';

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// Unduh Excel Data Pelayanan (spec §6.3). Sumber = RPC rekap_data_pelayanan (lingkup §6.1 ditegakkan DB) dengan paging
// keyset (satu halaman per panggilan di DB); maksimal 50.000 baris (header X-Rekap-Truncated, lembar Keterangan memuat
// peringatan). Service-role HANYA untuk menulis audit_log.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const parsed = rekapTerpaduExportSchema.safeParse(paramsDariRequest(request));
  if (!parsed.success) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors }, { status: 422 });
  }
  const q = parsed.data;
  const staf = await muatLingkup(supabase, LABEL);
  if (!staf.ok) return staf.res;

  const arg = argRekap(q);
  let hasil;
  try {
    hasil = await ambilSemuaDataPelayanan(supabase, arg);
  } catch (error) {
    return responsGalatRekap(error, LABEL);
  }
  const rows = hasil.rows.map(petaBarisPelayanan);
  const formType = await formLayanan(supabase, q.layanan_id);
  const namaLayanan = q.layanan_id
    ? (rows.find((r) => r.layanan_id === q.layanan_id)?.layanan_nama ?? q.layanan_id)
    : null;
  const unit = q.unit === 'fo' ? NAMA_UNIT_FO : q.unit === 'layanan' ? 'Semua Layanan' : null;
  const filter = [unit, namaLayanan].filter(Boolean).join(' · ') || 'Semua unit';

  const buf = await buildDataPelayananWorkbook(rows, kolomDataPelayanan(formType), {
    dari: q.dari, sampai: q.sampai, lingkup: labelLingkup(staf.lingkup), filter, truncated: hasil.truncated,
  });

  // audit_log hanya boleh ditulis server (service role); pengguna tidak punya INSERT langsung (S14).
  const { error: auditError } = (await getServiceClient()?.from('audit_log').insert({
    actor_id: staf.userId,
    actor_role: staf.lingkup.role,
    aksi: 'export_xlsx',
    entitas: 'rekap_data_pelayanan',
    detail: {
      dari: q.dari, sampai: q.sampai, unit: q.unit ?? null, layanan_id: q.layanan_id ?? null,
      koordinator: staf.lingkup.koordinator, total_rows: rows.length, truncated: hasil.truncated,
    },
  })) ?? { error: { message: 'service client tidak tersedia' } };
  if (auditError) console.error(`[${LABEL}] audit_log insert gagal:`, auditError);

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': contentDisposition(`data-pelayanan-${q.dari}-sd-${q.sampai}.xlsx`),
      'Cache-Control': 'no-store',
      'X-Rekap-Truncated': hasil.truncated ? 'true' : 'false',
    },
  });
}
