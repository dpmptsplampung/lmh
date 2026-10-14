import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { MutasiError, mutasiInsert } from '@/lib/supabase/mutate';
import { catatMutasiGagal } from '@/app/api/admin/_mutasi';
import { logServerEvent } from '@/lib/observability/logger';

export const dynamic = 'force-dynamic';

// rollup_rekap_harian hanya boleh dieksekusi service_role (REVOKE dari
// authenticated), jadi UI tidak bisa memanggil rpc langsung. Endpoint ini
// menjadi jalur admin/FO yang sah untuk mengisi ulang rekap per tanggal.
const bodySchema = z.object({
  dari: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sampai: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const MAX_SPAN_DAYS = 92;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: me } = await supabase
    .from('petugas')
    .select('id, role, aktif')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!me || me.aktif === false) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role !== 'admin' && me.role !== 'front_office') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
      { status: 422 },
    );
  }
  const { dari, sampai } = parsed.data;
  if (sampai < dari) {
    return NextResponse.json({ error: 'sampai tidak boleh sebelum dari' }, { status: 422 });
  }

  const start = new Date(`${dari}T00:00:00Z`);
  const end = new Date(`${sampai}T00:00:00Z`);
  const spanDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (spanDays < 1 || spanDays > MAX_SPAN_DAYS) {
    return NextResponse.json(
      { error: `Rentang maksimal ${MAX_SPAN_DAYS} hari` },
      { status: 422 },
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }
  const admin = createServiceClient(url, key, { auth: { persistSession: false } });

  const dates: string[] = [];
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }

  const gagal: string[] = [];
  for (const tgl of dates) {
    const { error } = await admin.rpc('rollup_rekap_harian', { p_tanggal: tgl });
    if (error) {
      // Pesan DB tidak masuk respons/audit (bisa memuat nama objek DB); hanya tanggal + kode SQLSTATE dicatat di log.
      gagal.push(tgl);
      logServerEvent('error', { operation: 'admin.rekap.rollup.tanggal', route: '/api/admin/rekap/rollup', tanggal: tgl, asalCode: error.code || undefined });
    }
  }

  // best-effort: rollup sudah dijalankan; gagal menulis audit tidak membatalkan hasilnya, tetapi dicatat (tidak ditelan).
  try {
    await mutasiInsert(
      admin.from('audit_log').insert({
        actor_id: user.id,
        actor_role: me.role,
        aksi: 'rollup_rekap',
        entitas: 'rekap_harian_layanan',
        detail: { dari, sampai, tanggal_count: dates.length, gagal },
      }),
    );
  } catch (e) {
    if (!(e instanceof MutasiError)) throw e;
    catatMutasiGagal('/api/admin/rekap/rollup', 'admin.rekap.rollup.audit', e, { tanggalCount: dates.length });
  }

  if (gagal.length > 0) {
    return NextResponse.json(
      { error: `Rollup gagal untuk tanggal: ${gagal.join(', ')}. Coba lagi.`, gagal },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, tanggal_count: dates.length });
}
