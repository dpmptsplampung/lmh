import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

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
    return NextResponse.json(
      { error: `Failed to fetch lead: ${leadErr.message}` },
      { status: 500 },
    );
  }

  if (!lead) {
    return NextResponse.json(
      { error: 'Lead tidak ditemukan' },
      { status: 404 },
    );
  }

  const { data: updated, error: updateErr } = await supabase
    .from('investasi_lead')
    .update({ status })
    .eq('id', leadId)
    .select('id, status')
    .maybeSingle();

  if (updateErr || !updated) {
    return NextResponse.json(
      { error: `Failed to update lead: ${updateErr?.message ?? 'no row returned'}` },
      { status: 500 },
    );
  }

  return NextResponse.json(updated, { status: 200 });
}
