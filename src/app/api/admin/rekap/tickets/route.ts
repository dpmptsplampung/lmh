import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ticketsQuerySchema } from '@/lib/rekap/schemas';
import { buildTicketsQuery } from '@/lib/rekap/query';
import { mapRawTicketRow } from '@/lib/rekap/rows';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: me } = await supabase
    .from('petugas')
    .select('id, role, layanan_id, aktif')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!me || me.aktif === false) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rawParams: Record<string, string> = {};
  const sp = request.nextUrl?.searchParams ?? new URL(request.url).searchParams;
  // Last-value-wins: jika key diulang (mis. ?q=a&q=b), hanya nilai terakhir
  // yang dipakai. Skema query hanya mendefinisikan satu nilai per key.
  sp.forEach((v, k) => {
    rawParams[k] = v;
  });

  const parsed = ticketsQuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
      { status: 422 },
    );
  }

  let effectiveLayananId: string | null;
  if (me.role === 'petugas') {
    if (parsed.data.layanan_id && parsed.data.layanan_id !== me.layanan_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    effectiveLayananId = me.layanan_id ?? null;
  } else {
    effectiveLayananId = parsed.data.layanan_id ?? null;
  }

  const pageSize = parsed.data.page_size;
  const page = parsed.data.page;
  const from = page * pageSize;
  const to = from + pageSize - 1;

  const query = buildTicketsQuery(supabase, {
    layananId: effectiveLayananId,
    q: parsed.data.q,
    dari: parsed.data.dari,
    sampai: parsed.data.sampai,
    from,
    to,
  });

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json({ error: 'Gagal memuat rekap' }, { status: 500 });
  }

  const rows = (data ?? []).map((r: Record<string, unknown>) => mapRawTicketRow(r));

  return NextResponse.json({ total: count ?? 0, rows });
}
