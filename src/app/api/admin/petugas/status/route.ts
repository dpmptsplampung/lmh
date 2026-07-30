import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

// RBA-08 / RBA-07: kelola status aktif petugas & pergantian PIC.
//  - FO: hanya MENONAKTIFKAN (satu arah, wajib alasan). TIDAK bisa mengaktifkan kembali.
//  - Admin: menonaktifkan, mengaktifkan kembali, dan pergantian PIC (reset password +
//    akhiri sesi pemegang lama, I-23).

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
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
    email_baru?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { aksi, petugas_id, alasan, email_baru } = body;
  if (!aksi || !petugas_id) {
    return NextResponse.json({ error: 'aksi dan petugas_id diperlukan' }, { status: 400 });
  }

  const service = getServiceClient();
  if (!service) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });

  // ---- RBA-08: FO/Admin menonaktifkan (wajib alasan) ----
  if (aksi === 'nonaktifkan') {
    if (actor.role !== 'admin' && actor.role !== 'front_office') {
      return NextResponse.json({ error: 'Hanya Admin/FO yang boleh menonaktifkan' }, { status: 403 });
    }
    if (!alasan || !alasan.trim()) {
      return NextResponse.json({ error: 'Alasan nonaktif wajib diisi (RBA-08)' }, { status: 400 });
    }
    const { error } = await service.rpc('petugas_set_nonaktif', {
      p_petugas_id: petugas_id,
      p_alasan: alasan.trim(),
      p_actor: actor.id,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

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
    return NextResponse.json({ ok: true });
  }

  // ---- Admin only di bawah ini ----
  if (actor.role !== 'admin') {
    return NextResponse.json({ error: 'Hanya Admin' }, { status: 403 });
  }

  // ---- RBA-08: Admin mengaktifkan kembali ----
  if (aksi === 'aktifkan') {
    const { error } = await service.rpc('petugas_set_aktif', { p_petugas_id: petugas_id });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  // ---- RBA-07: pergantian PIC (reset password + akhiri sesi pemegang lama, I-23) ----
  if (aksi === 'ganti_pic') {
    if (!email_baru || !email_baru.includes('@')) {
      return NextResponse.json({ error: 'email_baru valid diperlukan untuk pergantian PIC' }, { status: 400 });
    }
    // Ambil auth_user_id pemegang lama.
    const { data: target } = await service
      .from('petugas')
      .select('id, auth_user_id, nama, layanan_id')
      .eq('id', petugas_id)
      .maybeSingle();
    if (!target) return NextResponse.json({ error: 'Petugas tidak ditemukan' }, { status: 404 });

    // 1) Akhiri seluruh sesi pemegang lama (I-23).
    if (target.auth_user_id) {
      await service.auth.admin.signOut(target.auth_user_id, 'global');
    }

    // 2) Kirim undangan/reset ke pemegang baru (satu layanan satu akun; akun tidak diganti).
    const { error: inviteErr } = await service.auth.admin.inviteUserByEmail(email_baru, {
      redirectTo: `${process.env.NEXT_PUBLIC_PUBLIC_URL ?? ''}/auth/callback`,
    });
    if (inviteErr) {
      return NextResponse.json({ error: `Gagal mengundang pemegang baru: ${inviteErr.message}` }, { status: 400 });
    }

    // 3) Catat pergantian di audit_log sebagai garis waktu pemegang (RBA-07).
    await service.from('audit_log').insert({
      actor_id: actor.id,
      actor_role: 'admin',
      aksi: 'ganti_pic',
      entitas: 'petugas',
      entitas_id: petugas_id,
      detail: {
        petugas_nama: target.nama,
        layanan_id: target.layanan_id,
        email_baru,
        sesi_lama_diakhiri: true,
      },
    });

    return NextResponse.json({ ok: true, pesan: 'Undangan dikirim ke pemegang baru; sesi lama diakhiri.' });
  }

  return NextResponse.json({ error: 'aksi tidak dikenal' }, { status: 400 });
}
