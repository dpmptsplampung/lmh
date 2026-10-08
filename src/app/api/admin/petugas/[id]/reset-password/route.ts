import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { audit, generateTempPassword, json, requireAdmin } from '@/lib/akun/server';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// Admin mengatur ulang sandi akun lain: sandi sementara ditampilkan SEKALI, semua sesi diakhiri,
// wajib_ganti_sandi=true. Admin tidak bisa mereset dirinya sendiri lewat jalur ini.
export async function POST(_request: NextRequest, { params }: Ctx) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const { actor, service } = g;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return json({ error: 'id tidak valid' }, 400);
  if (id === actor.id) return json({ error: 'Admin tidak bisa mengatur ulang sandi sendiri lewat jalur ini' }, 403);

  const { data: target } = await service.from('petugas').select('id, auth_user_id').eq('id', id).maybeSingle();
  if (!target?.auth_user_id) return json({ error: 'Akun tidak ditemukan' }, 404);

  const sandi = generateTempPassword();
  const { error } = await service.auth.admin.updateUserById(target.auth_user_id, { password: sandi });
  if (error) {
    console.error('[admin/petugas reset-password] gagal', error.message);
    return json({ error: 'Gagal mengatur ulang sandi' }, 502);
  }
  await service.from('petugas').update({ wajib_ganti_sandi: true }).eq('id', id);
  await service.rpc('akun_akhiri_sesi', { p_auth_user_id: target.auth_user_id });
  await audit(service, actor, 'akun_reset_sandi', id, { wajib_ganti_sandi: true, sesi_diakhiri: true });
  return json({ ok: true, sandi_sementara: sandi, wajib_ganti_sandi: true });
}
