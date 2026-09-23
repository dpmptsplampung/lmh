import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { exportQuerySchema } from '@/lib/rekap/schemas';
import { fetchAllTicketRows } from '@/lib/rekap/exportAll';
import { buildRekapWorkbook, type RekapTicketRow } from '@/lib/rekap/excel';
import { mapRawTicketRow } from '@/lib/rekap/rows';
import { slugify } from '@/lib/rekap/format';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Encode as RFC 6266 filename* (UTF-8) — aman untuk nama layanan non-ASCII. */
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { data: me } = await supabase
    .from('petugas')
    .select('id, role, layanan_id, aktif')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!me || me.aktif === false) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rawParams: Record<string, string> = {};
  const sp =
    request.nextUrl?.searchParams ?? new URL(request.url).searchParams;
  sp.forEach((v, k) => {
    rawParams[k] = v;
  });

  const parsed = exportQuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        error: 'Invalid input',
        details: parsed.error.flatten().fieldErrors,
      }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let effectiveLayananId: string | null;
  let layananNama = 'semua-layanan';
  if (me.role === 'petugas') {
    if (parsed.data.layanan_id && parsed.data.layanan_id !== me.layanan_id) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    effectiveLayananId = me.layanan_id ?? null;
    if (effectiveLayananId) {
      const { data: l } = await supabase
        .from('layanan')
        .select('nama')
        .eq('id', effectiveLayananId)
        .maybeSingle();
      layananNama = l?.nama ? slugify(l.nama) : 'layanan';
    }
  } else {
    effectiveLayananId = parsed.data.layanan_id ?? null;
    if (effectiveLayananId) {
      const { data: l } = await supabase
        .from('layanan')
        .select('nama')
        .eq('id', effectiveLayananId)
        .maybeSingle();
      layananNama = l?.nama ? slugify(l.nama) : 'layanan';
    }
  }

  let fetched: Awaited<ReturnType<typeof fetchAllTicketRows>>;
  try {
    fetched = await fetchAllTicketRows(supabase, {
      layananId: effectiveLayananId,
      q: parsed.data.q,
      dari: parsed.data.dari,
      sampai: parsed.data.sampai,
    });
  } catch (e) {
    console.error('[api/admin/rekap/export] gagal memuat tiket:', e);
    return new Response(JSON.stringify({ error: 'Gagal memuat rekap' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rows: RekapTicketRow[] = fetched.rows.map(mapRawTicketRow);

  const truncated = fetched.truncated;
  const buf = await buildRekapWorkbook(rows);

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    actor_role: me.role,
    aksi: 'export_xlsx',
    entitas: 'rekap_pelayanan',
    detail: {
      layanan_id: effectiveLayananId,
      dari: parsed.data.dari,
      sampai: parsed.data.sampai,
      q: parsed.data.q,
      total_rows: rows.length,
      truncated,
    },
  });

  const filename = `rekap-${layananNama}-${parsed.data.dari}-sd-${parsed.data.sampai}.xlsx`;

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': contentDisposition(filename),
      'Cache-Control': 'no-store',
      'X-Rekap-Truncated': truncated ? 'true' : 'false',
    },
  });
}
