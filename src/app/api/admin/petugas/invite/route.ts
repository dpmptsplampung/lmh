import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { z } from 'zod';

const bodySchema = z.object({
  email: z.email(),
  password: z.string().min(6),
  nama: z.string().min(2).max(200),
  layanan_id: z.string().uuid(),
  role: z.enum(['petugas', 'admin']).default('petugas'),
});

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key);
}

export async function POST(request: NextRequest) {
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

  const { email, password, nama, layanan_id, role } = parsed.data;

  const adminClient = getServiceClient();
  if (!adminClient) {
    return NextResponse.json(
      { error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY required' },
      { status: 500 },
    );
  }

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError) {
    const msg = createError.message.toLowerCase();
    if (msg.includes('already') || msg.includes('exists') || msg.includes('registered')) {
      return NextResponse.json(
        { error: 'Email sudah terdaftar di sistem.' },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: createError.message },
      { status: 500 },
    );
  }

  const userId = created.user?.id;
  if (!userId) {
    return NextResponse.json(
      { error: 'Failed to create user: no user id returned' },
      { status: 500 },
    );
  }

  const { error: insertError } = await adminClient
    .from('petugas')
    .insert({
      auth_user_id: userId,
      nama,
      layanan_id,
      role,
    });

  if (insertError) {
    return NextResponse.json(
      { error: `Failed to insert petugas row: ${insertError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { user_id: userId, success: true },
    { status: 201 },
  );
}
