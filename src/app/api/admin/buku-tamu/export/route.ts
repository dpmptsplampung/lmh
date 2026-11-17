import type { NextRequest } from 'next/server';
import { json } from '@/lib/akun/server';
import { guardTamu, queryEksporTamu, semuaTamu, tanggalTamu } from '@/lib/buku-tamu/server';
import { berkasTamu } from '@/lib/buku-tamu/export';
import { catatAuditEkspor } from '@/lib/rekap/exportAudit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const g = await guardTamu();
  if ('res' in g) return g.res;
  const parsed = queryEksporTamu.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors }, 400);
  const q = parsed.data;
  try {
    const { rows, truncated } = await semuaTamu(g.supabase, q);
    const buf = await berkasTamu(rows, q.format, g.me.role, truncated);
    const { dari, sampai } = tanggalTamu(q);
    await catatAuditEkspor(g.user.id, g.me.role, q.format === 'csv' ? 'export_csv' : 'export_xlsx', 'buku_tamu', {
      dari, sampai, pencarian: Boolean(q.q), total_rows: rows.length, truncated,
    });
    return new Response(buf, { headers: {
      'Content-Type': q.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="buku-tamu-${dari}-sd-${sampai}.${q.format}"`,
      'Cache-Control': 'no-store', 'X-Rekap-Truncated': String(truncated),
    } });
  } catch {
    console.error('[admin/buku-tamu/export] pembuatan berkas atau audit ekspor gagal');
    return json({ error: 'Gagal menyiapkan atau mencatat ekspor buku tamu' }, 500);
  }
}
