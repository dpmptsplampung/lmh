import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { audit } from '@/lib/akun/server';

export const dynamic = 'force-dynamic';

// RBA-08 / RBA-07: kelola status aktif petugas & pergantian PIC.
//  - Admin SAJA: menonaktifkan dan mengaktifkan kembali (dicatat di audit_log lewat audit()).
//    Aksi `ganti_pic` DIHAPUS (410): jalur itu tidak mencabut kredensial lama; ganti pemegang akun =
//    reset sandi / ubah username-email login di PATCH /api/admin/petugas/{id}. FO TIDAK boleh (S1); RPC
//    petugas_set_nonaktif juga menegakkannya di DB (admin aktif / service_role).

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// ban_duration di Supabase Auth: ~100 tahun = diblokir; 'none' = buka. Sesi diakhiri lewat RPC (auth.sessions).
async function tutupAkses(service: NonNullable<ReturnType<typeof getServiceClient>>, petugasId: string, blokir: boolean) {
  const { data: t } = await service.from('petugas').select('auth_user_id').eq('id', petugasId).maybeSingle();
  if (!t?.auth_user_id) return false;
  const { error } = await service.auth.admin.updateUserById(t.auth_user_id, { ban_duration: blokir ? '876000h' : 'none' });
  if (error) { console.error('[admin/petugas/status] ban_duration gagal', error.message); return false; }
  if (blokir) await service.rpc('akun_akhiri_sesi', { p_auth_user_id: t.auth_user_id });
  return true;
}

async function getActor(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: p } = await supabase
    .from('petugas')
    .select('id, role, aktif')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  return p && p.aktif !== false ? p : null;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const actor = await getActor(supabase);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: {
    aksi?: string;
    petugas_id?: string;
    alasan?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { aksi, petugas_id, alasan } = body;
  if (!aksi || !petugas_id) {
    return NextResponse.json({ error: 'aksi dan petugas_id diperlukan' }, { status: 400 });
  }

  const service = getServiceClient();
  if (!service) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });

  // ---- RBA-08: Admin menonaktifkan (wajib alasan) ----
  if (aksi === 'nonaktifkan') {
    if (actor.role !== 'admin') {
      return NextResponse.json({ error: 'Hanya Admin yang boleh menonaktifkan' }, { status: 403 });
    }
    if (!alasan || !alasan.trim()) {
      return NextResponse.json({ error: 'Alasan nonaktif wajib diisi (RBA-08)' }, { status: 400 });
    }
    const { error } = await service.rpc('petugas_set_nonaktif', {
      p_petugas_id: petugas_id,
      p_alasan: alasan.trim(),
      p_actor: actor.id,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: error.code === '42501' ? 403 : 400 });

    // Admin mendapat pemberitahuan (RBA-08).
    await service.from('notifikasi').insert({
      kanal: 'email',
      tujuan_email: null,
      subjek: '[LMH] Akun petugas dinonaktifkan',
      body: `Akun petugas ${petugas_id} dinonaktifkan oleh ${actor.role} (id ${actor.id}). Alasan: ${alasan.trim()}`,
      status: 'pending',
      idempotency_key: `nonaktif:${petugas_id}:${Date.now()}`,
      payload: { petugas_id, actor: actor.id, alasan: alasan.trim() },
    });
    // Blokir login di Auth + akhiri semua sesi (akun bersama: perangkat lain ikut keluar).
    const sesi = await tutupAkses(service, petugas_id, true);
    await audit(service, actor, 'akun_nonaktifkan', petugas_id, { alasan: alasan.trim(), sesi_diakhiri: sesi });
    return NextResponse.json({ ok: true, ...(sesi ? {} : { peringatan: 'Akun nonaktif, tetapi blokir/sesi Auth gagal; role sudah dicabut.' }) });
  }

  // ---- Admin only di bawah ini ----
  if (actor.role !== 'admin') {
    return NextResponse.json({ error: 'Hanya Admin' }, { status: 403 });
  }

  // ---- RBA-08: Admin mengaktifkan kembali ----
  if (aksi === 'aktifkan') {
    // Dipanggil lewat service_role (auth.uid() NULL): fungsi DB mengizinkan service_role; admin
    // sudah diverifikasi aktif di atas (getActor).
    const { error } = await service.rpc('petugas_set_aktif', { p_petugas_id: petugas_id });
    if (error) return NextResponse.json({ error: error.message }, { status: error.code === '42501' ? 403 : 400 });
    const dibuka = await tutupAkses(service, petugas_id, false);
    await audit(service, actor, 'akun_aktifkan', petugas_id, { blokir_dibuka: dibuka });
    return NextResponse.json({ ok: true, ...(dibuka ? {} : { peringatan: 'Akun aktif, tetapi pembukaan blokir Auth gagal.' }) });
  }

  if (aksi === 'ganti_pic') {
    return NextResponse.json(
      { error: 'Aksi ganti_pic sudah dihapus. Gunakan reset sandi atau ubah username/email login akun.' },
      { status: 410 },
    );
  }

  return NextResponse.json({ error: 'aksi tidak dikenal' }, { status: 400 });
}
