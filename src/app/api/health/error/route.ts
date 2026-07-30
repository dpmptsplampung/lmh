import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// SEC-03: endpoint observability untuk Admin — daftar error terbaru dari error_log.
// Akses: hanya role 'admin' (RLS error_log_admin_read juga menegakkan di DB).
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: petugas } = await supabase
    .from('petugas')
    .select('role')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!petugas || petugas.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const limitParam = Number(request.nextUrl.searchParams.get('limit') ?? '50');
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50;

  const { data, error, count } = await supabase
    .from('error_log')
    .select('id, level, route, method, operation, request_id, status_code, message, environment, version, created_at', {
      count: 'exact',
    })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: 'Gagal memuat error_log' }, { status: 500 });
  }

  // Ringkasan 24 jam terakhir untuk indikator cepat.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: last24h } = await supabase
    .from('error_log')
    .select('*', { count: 'exact', head: true })
    .eq('level', 'error')
    .gte('created_at', since);

  return NextResponse.json({
    total: count ?? 0,
    error_last_24h: last24h ?? 0,
    rows: data ?? [],
  });
}
