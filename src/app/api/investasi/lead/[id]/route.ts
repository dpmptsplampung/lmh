import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { mutasiWajibBaris } from '@/lib/supabase/mutate';
import { z } from 'zod';
import { catatMutasi } from '@/lib/observability/catat-mutasi';

const bodySchema = z.object({
  status: z.enum(['baru', 'dihubungi', 'berlanjut', 'ditolak', 'selesai']),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leadId } = await params;

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(parsedBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { status } = parsed.data;

  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
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

  const { data: lead, error: leadErr } = await supabase
    .from('investasi_lead')
    .select('id')
    .eq('id', leadId)
    .maybeSingle();

  if (leadErr) {
    console.error('[investasi/lead] fetch failed', leadErr);
    return NextResponse.json({ error: 'Gagal memuat lead' }, { status: 500 });
  }

  if (!lead) {
    return NextResponse.json(
      { error: 'Lead tidak ditemukan' },
      { status: 404 },
    );
  }

  let updated: { id: string; status: string };
  try {
    // Baris lead sudah terbukti ada (dibaca di atas), jadi 0 baris = RLS menolak diam-diam -> gagal, bukan sukses.
    [updated] = await mutasiWajibBaris<{ id: string; status: string }>(
      supabase
        .from('investasi_lead')
        .update({ status })
        .eq('id', leadId)
        .select('id, status')
        .maybeSingle(),
    );
  } catch (e) {
    catatMutasi('error', 'investasi_lead.update_status', '/api/investasi/lead/[id]', e, { leadId });
    return NextResponse.json({ error: 'Gagal memperbarui lead' }, { status: 500 });
  }

  return NextResponse.json(updated, { status: 200 });
}
