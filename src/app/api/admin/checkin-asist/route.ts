import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { z } from 'zod';

// I9.5: Mode bantuan petugas — checkin manual untuk pengunjung yang tidak
// bisa menggunakan kiosk. Petugas mengisi form, INSERT via service-role
// karena RLS visit_insert_walk_in memakai check_anon_rate yang bisa
// memblok petugas setelah 5 insert/60s.

const bodySchema = z.object({
  nama: z.string().min(1).max(200),
  layanan_id: z.uuid(),
  keperluan: z.string().max(2000).optional(),
  asal_instansi: z.string().max(200).optional(),
});

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false } });
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

  if (!petugas || !['petugas', 'admin'].includes(petugas.role)) {
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

  const { nama, layanan_id, keperluan, asal_instansi } = parsed.data;

  const adminClient = getServiceClient();
  if (!adminClient) {
    return NextResponse.json(
      { error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY required' },
      { status: 500 },
    );
  }

  const { data: insertData, error: insertError } = await adminClient
    .from('visit')
    .insert({
      asal: 'walk_in',
      pengunjung_id: null,
      nama: nama.trim(),
      asal_instansi: asal_instansi?.trim() || null,
      layanan_id,
      keperluan: keperluan?.trim() || null,
      tujuan: 'loket',
      status: 'menunggu',
      waktu_masuk: new Date().toISOString(),
    })
    .select('id')
    .maybeSingle();

  if (insertError) {
    return NextResponse.json(
      { error: `Gagal menyimpan: ${insertError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { id: insertData?.id, message: 'Check-in bantuan berhasil' },
    { status: 201 },
  );
}
