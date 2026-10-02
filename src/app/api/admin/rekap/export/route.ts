import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { exportQuerySchema } from '@/lib/rekap/schemas';
import { fetchAllTicketRows } from '@/lib/rekap/exportAll';
import {
  buildRekapWorkbook,
  type RekapOssRow,
  type RekapPerizinanRow,
  type RekapTicketRow,
  type RekapUmumRow,
} from '@/lib/rekap/excel';
import { mapRawTicketRow } from '@/lib/rekap/rows';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function rawParams(request: NextRequest): Record<string, string> {
  const params: Record<string, string> = {};
  (request.nextUrl?.searchParams ?? new URL(request.url).searchParams).forEach((value, key) => {
    params[key] = value;
  });
  return params;
}

async function fetchTabRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tab: 'umum' | 'oss' | 'perizinan',
  dari: string,
  sampai: string,
) {
  const source = tab === 'umum'
    ? 'rekap_harian_layanan'
    : tab === 'oss'
      ? 'v_rekap_pelayanan_oss'
      : 'v_rekap_pelayanan_perizinan';
  const { data, error } = await supabase
    .from(source)
    .select(tab === 'umum' ? '*, layanan:layanan_id(nama)' : '*')
    .gte('tanggal', dari)
    .lte('tanggal', sampai)
    .order(tab === 'umum' ? 'tanggal' : 'created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: me } = await supabase
    .from('petugas')
    .select('id, role, layanan_id, aktif')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!me || me.aktif === false) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = exportQuerySchema.safeParse(rawParams(request));
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
      { status: 422 },
    );
  }

  const { tab, dari, sampai, q } = parsed.data;
  let rows: RekapTicketRow[] | RekapUmumRow[] | RekapOssRow[] | RekapPerizinanRow[];
  let truncated = false;

  try {
    if (tab === 'layanan') {
      let layananId: string | null;
      if (me.role === 'petugas') {
        if (parsed.data.layanan_id && parsed.data.layanan_id !== me.layanan_id) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }
        layananId = me.layanan_id ?? null;
      } else {
        layananId = parsed.data.layanan_id ?? null;
      }
      const fetched = await fetchAllTicketRows(supabase, { layananId, q, dari, sampai });
      rows = fetched.rows.map(mapRawTicketRow);
      truncated = fetched.truncated;
    } else {
      // Views use security_invoker=true: existing grants/RLS determine row scope.
      rows = await fetchTabRows(supabase, tab, dari, sampai) as unknown as RekapUmumRow[] | RekapOssRow[] | RekapPerizinanRow[];
    }
  } catch (error) {
    console.error('[api/admin/rekap/export] gagal memuat rekap:', error);
    return Response.json({ error: 'Gagal memuat rekap' }, { status: 500 });
  }

  const buf = await buildRekapWorkbook(tab, rows);
  const { error: auditError } = await supabase.from('audit_log').insert({
    actor_id: user.id,
    actor_role: me.role,
    aksi: 'export_xlsx',
    entitas: 'rekap_pelayanan',
    detail: { tab, dari, sampai, q, total_rows: rows.length, truncated },
  });
  if (auditError) {
    console.error('[api/admin/rekap/export] audit_log insert gagal:', auditError);
  }

  const filename = `rekap-${tab}-${dari}-sd-${sampai}.xlsx`;
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
