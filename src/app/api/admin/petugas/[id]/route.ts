import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { audit, json, requireAdmin } from '@/lib/akun/server';
import { isSyntheticEmail, isValidUsername, normalizeNoHp, normalizeUsername, usernameToEmail } from '@/lib/akun/login';

export const dynamic = 'force-dynamic';

const schema = z
  .object({
    nama: z.string().trim().min(2).max(200),
    no_hp: z.string().trim().nullable(),
    layanan_id: z.uuid().nullable(),
    username: z.string(),
    email_notifikasi: z.email().max(254).nullable(),
    role: z.enum(['admin', 'front_office', 'petugas']),
    email_login: z.email().max(254),
  })
  .partial()
  .strict();

type Ctx = { params: Promise<{ id: string }> };

// PATCH edit akun layanan (Admin). Urutan: tulis petugas (unik username dijaga DB) -> sinkron Auth -> bila gagal batalkan.
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const { actor, service } = g;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return json({ error: 'id tidak valid' }, 400);

  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return json({ error: 'Invalid input', details: parsed.success ? {} : parsed.error.flatten().fieldErrors }, 400);
  }
  const b = parsed.data;

  const { data: target } = await service
    .from('petugas')
    .select('id, auth_user_id, role, layanan_id, username, email_notifikasi')
    .eq('id', id)
    .maybeSingle();
  if (!target) return json({ error: 'Akun tidak ditemukan' }, 404);
  const self = target.id === actor.id;

  // ---- validasi aturan ----
  const upd: Record<string, unknown> = {};
  if (b.nama !== undefined) upd.nama = b.nama;
  if (b.no_hp !== undefined) {
    const n = b.no_hp === null || b.no_hp === '' ? null : normalizeNoHp(b.no_hp);
    if (b.no_hp && !n) return json({ error: 'Format nomor HP tidak valid' }, 400);
    upd.no_hp = n;
  }
  if (b.layanan_id !== undefined) upd.layanan_id = b.layanan_id;
  if (b.role !== undefined && b.role !== target.role) {
    if (self) return json({ error: 'Tidak boleh mengubah role akun sendiri' }, 403);
    upd.role = b.role;
  }
  const roleAkhir = (upd.role as string | undefined) ?? target.role;
  const layananAkhir = 'layanan_id' in upd ? upd.layanan_id : target.layanan_id;
  if (roleAkhir === 'petugas' && !layananAkhir) return json({ error: 'layanan_id wajib untuk role petugas' }, 400);
  if (b.email_notifikasi !== undefined) {
    const e = b.email_notifikasi?.toLowerCase() ?? null;
    if (e !== target.email_notifikasi) {
      upd.email_notifikasi = e;
      upd.email_notifikasi_verified_at = null;
    }
  }
  let usernameBaru: string | null = null;
  if (b.username !== undefined) {
    const u = normalizeUsername(b.username);
    if (!isValidUsername(u)) return json({ error: 'Username tidak valid (huruf kecil/angka/-, 3-32 karakter)' }, 400);
    if (u !== target.username) { usernameBaru = u; upd.username = u; }
  }
  if (b.email_login !== undefined) {
    if (usernameBaru) return json({ error: 'Ubah username ATAU email_login, tidak keduanya' }, 400);
    if (isSyntheticEmail(b.email_login)) return json({ error: 'Gunakan username untuk email login sintetis' }, 400);
  }

  // ---- tulis petugas ----
  if (Object.keys(upd).length > 0) {
    const { error } = await service.from('petugas').update(upd).eq('id', id);
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === '23505') return json({ error: 'Username sudah dipakai' }, 409);
      if (code === '23514') return json({ error: 'Data tidak memenuhi aturan format' }, 400);
      if (/Admin aktif terakhir/i.test(error.message)) return json({ error: error.message }, 409);
      console.error('[admin/petugas PATCH] update gagal', error.message);
      return json({ error: 'Gagal menyimpan perubahan' }, 500);
    }
  }

  // ---- sinkron email login di Supabase Auth ----
  const emailAuthBaru = usernameBaru ? usernameToEmail(usernameBaru) : b.email_login?.toLowerCase();
  if (emailAuthBaru && target.auth_user_id) {
    const { error: authErr } = await service.auth.admin.updateUserById(target.auth_user_id, {
      email: emailAuthBaru,
      email_confirm: true,
    });
    if (authErr) {
      if (usernameBaru) await service.from('petugas').update({ username: target.username }).eq('id', id);
      const dupe = /already|exists|registered/i.test(authErr.message);
      console.error('[admin/petugas PATCH] sinkron email login gagal', authErr.message);
      return json({ error: dupe ? 'Email login sudah dipakai akun lain' : 'Gagal menyinkronkan email login' }, dupe ? 409 : 502);
    }
    if (!self) await service.rpc('akun_akhiri_sesi', { p_auth_user_id: target.auth_user_id });
  }

  await audit(service, actor, 'akun_ubah', id, {
    kolom: Object.keys(upd).filter((k) => k !== 'email_notifikasi_verified_at'),
    role: 'role' in upd ? { dari: target.role, ke: upd.role } : undefined,
    username: usernameBaru ? { dari: target.username, ke: usernameBaru } : undefined,
    email_login_diganti: emailAuthBaru ? true : undefined,
    sesi_diakhiri: emailAuthBaru && !self ? true : undefined,
  });
  return json({ ok: true });
}
