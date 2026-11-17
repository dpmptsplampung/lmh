import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { paramsDariRequest } from '@/lib/rekap/akses';
import { buildDataPelayananWorkbook } from '@/lib/rekap/excelTerpadu';
import { kolomDataPelayanan, NAMA_UNIT_FO, petaBarisPelayanan, rekapTerpaduExportSchema } from '@/lib/rekap/terpadu';
import { ambilSemuaDataPelayanan, argData, formLayanan, muatLingkup, responsGalatRekap } from '@/lib/rekap/terpaduServer';
import { lampirkanKhusus } from '@/lib/rekap/khusus';
import type { FieldKhusus } from '@/lib/pendataan-khusus/jenis';
import { muatFieldKhusus, muatJawabanKhusus } from '@/lib/rekap/khususServer';
import { catatAuditEkspor } from '@/lib/rekap/exportAudit';
import { buatWorkbookTerpadu, kolomEksporAman, kolomEksporKhusus } from '@/lib/rekap/exportTerpadu';
import { muatLayananEkspor } from '@/lib/rekap/exportServer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

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

  const multi = !q.layanan_id && q.unit !== 'fo';
  let hasil;
  let rows;
  let layanan;
  let formType;
  let fieldKhusus: FieldKhusus[] = [];
  try {
    hasil = await ambilSemuaDataPelayanan(supabase, argData(q));
    rows = hasil.rows.map(petaBarisPelayanan);
    layanan = multi ? await muatLayananEkspor(supabase, q.tanpa_form === '1') : [];
    formType = await formLayanan(supabase, q.layanan_id);
    fieldKhusus = await muatFieldKhusus(supabase, q.layanan_id, { semuaHalaman: true });
    if (fieldKhusus.length || layanan.some(l => l.fields.length)) {
      const jawaban = await muatJawabanKhusus(supabase, rows.filter(r => r.sumber === 'penanganan').map(r => r.pelayanan_id));
      rows = lampirkanKhusus(rows, jawaban);
    }
  } catch (error) {
    return responsGalatRekap(error, LABEL);
  }
  const namaLayanan = q.layanan_id
    ? (rows.find((r) => r.layanan_id === q.layanan_id)?.layanan_nama ?? q.layanan_id)
    : null;
  const unit = q.unit === 'fo' ? NAMA_UNIT_FO : q.unit === 'layanan' ? 'Semua Layanan' : null;
  const tanpaForm = q.tanpa_form === '1' ? 'Layanan lain (tanpa Helpdesk OSS dan Non OSS)' : null;
  const filter = [unit, namaLayanan, tanpaForm].filter(Boolean).join(' · ') || 'Semua unit';

  let buf;
  try {
    const meta = {
      dari: q.dari, sampai: q.sampai,
      lingkup: staf.lingkup.role === 'petugas' ? 'Seluruh data layanan Anda.' : 'Semua data semua layanan.',
      filter, truncated: hasil.truncated,
    };
    buf = multi
      ? await buatWorkbookTerpadu(rows, layanan, meta, staf.lingkup.role)
      : await buildDataPelayananWorkbook(rows,
        kolomEksporAman(kolomDataPelayanan(formType, kolomEksporKhusus(fieldKhusus)), staf.lingkup.role), meta);
    await catatAuditEkspor(staf.userId, staf.lingkup.role, 'export_xlsx', 'rekap_data_pelayanan', {
      dari: q.dari, sampai: q.sampai, unit: q.unit ?? null, layanan_id: q.layanan_id ?? null,
      koordinator: staf.lingkup.koordinator, tanpa_form: q.tanpa_form === '1', multi_sheet: multi,
      total_rows: rows.length, truncated: hasil.truncated,
    });
  } catch {
    console.error(`[${LABEL}] pembuatan berkas atau audit ekspor gagal`);
    return NextResponse.json({ error: 'Gagal menyiapkan atau mencatat ekspor' }, { status: 500 });
  }

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
