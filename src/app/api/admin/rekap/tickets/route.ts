import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ticketsQuerySchema } from '@/lib/rekap/schemas';
import { buildTicketsQuery } from '@/lib/rekap/query';
import type { RekapTicketRow } from '@/lib/rekap/excel';

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

  const rows: RekapTicketRow[] = (data ?? []).map((r: Record<string, unknown>) => {
    const oss = r.pelayanan_oss as RekapTicketRow['pelayanan_oss'];
    const per = r.pelayanan_perizinAN as RekapTicketRow['pelayanan_perizinAN'];
    const form_type: RekapTicketRow['form_type'] = oss ? 'oss' : per ? 'perizinAN' : null;
    return {
      id: r.id as string,
      nomor_display: r.nomor_display as string,
      tanggal: r.tanggal as string,
      waktu_terbit: r.waktu_terbit as string,
      waktu_mulai_layan: (r.waktu_mulai_layan as string | null) ?? null,
      waktu_selesai: (r.waktu_selesai as string | null) ?? null,
      status: r.status as string,
      kunjungan: r.kunjungan as RekapTicketRow['kunjungan'],
      petugas: r.petugas as RekapTicketRow['petugas'],
      form_type,
      pelayanan_oss: oss ?? null,
      pelayanan_perizinAN: per ?? null,
    };
  });

  return NextResponse.json({ total: count ?? 0, rows });
}
