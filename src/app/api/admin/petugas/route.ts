import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { audit, generateTempPassword, json, requireAdmin } from '@/lib/akun/server';
import { isValidUsername, normalizeNoHp, normalizeUsername, usernameToEmail } from '@/lib/akun/login';

export const dynamic = 'force-dynamic';

// GET daftar akun (Admin aktif): termasuk last_sign_in_at / belum_pernah_login, email notifikasi tersamar.
export async function GET() {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const { data, error } = await g.service.rpc('akun_daftar');
  if (error) {
    console.error('[admin/petugas] akun_daftar gagal', error.message);
    return json({ error: 'Gagal memuat daftar akun' }, 500);
  }
  return json({ akun: data ?? [] });
}

const createSchema = z
  .object({
    username: z.string(),
    nama: z.string().trim().min(2).max(200),
    role: z.enum(['admin', 'front_office', 'petugas']),
    layanan_id: z.uuid().nullable().optional(),
    no_hp: z.string().trim().max(30).nullable().optional(),
    email_notifikasi: z.email().max(254).nullable().optional(),
    sandi_sementara: z.string().min(8).max(72).optional(),
  })
  .strict();

// POST buat akun layanan by username (Admin aktif). Email login sintetis (resolveLoginEmail), sandi sementara
// (dibuat server bila tidak diberikan) dikembalikan SEKALI; akun wajib ganti sandi saat login pertama.
export async function POST(request: NextRequest) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const { actor, service } = g;

  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors }, 400);
  const b = parsed.data;

  const username = normalizeUsername(b.username);
  if (!isValidUsername(username)) return json({ error: 'Username tidak valid (huruf kecil/angka/-, 3-32 karakter)' }, 400);
  // Front Office/Admin lintas layanan: layanan_id dikosongkan (S19). Petugas wajib punya layanan.
  const layananId = b.role === 'petugas' ? (b.layanan_id ?? null) : null;
  if (b.role === 'petugas' && !layananId) return json({ error: 'layanan_id wajib untuk role petugas' }, 400);
  let noHp: string | null = null;
  if (b.no_hp) {
    noHp = normalizeNoHp(b.no_hp);
    if (!noHp) return json({ error: 'Format nomor HP tidak valid' }, 400);
  }

  const { data: ada } = await service.from('petugas').select('id').eq('username', username).maybeSingle();
  if (ada) return json({ error: 'Username sudah dipakai' }, 409);

  const sandi = b.sandi_sementara ?? generateTempPassword();
  const { data: created, error: createErr } = await service.auth.admin.createUser({
    email: usernameToEmail(username),
    password: sandi,
    email_confirm: true,
  });
  if (createErr || !created?.user) {
    const dupe = !!createErr && /already|exists|registered/i.test(createErr.message);
    if (!dupe) console.error('[admin/petugas POST] createUser gagal', createErr?.message);
    return json({ error: dupe ? 'Username sudah dipakai' : 'Gagal membuat akun' }, dupe ? 409 : 502);
  }

  const { data: baris, error: insErr } = await service
    .from('petugas')
    .insert({
      auth_user_id: created.user.id,
      nama: b.nama,
      username,
      role: b.role,
      layanan_id: layananId,
      no_hp: noHp,
      email_notifikasi: b.email_notifikasi?.toLowerCase() ?? null,
      aktif: true,
      wajib_ganti_sandi: true,
    })
    .select('id')
    .single();
  if (insErr || !baris) {
    await service.auth.admin.deleteUser(created.user.id); // batalkan: jangan tinggalkan akun auth yatim
    const code = (insErr as { code?: string } | null)?.code;
    if (code === '23505') return json({ error: 'Username sudah dipakai' }, 409);
    if (code === '23514' || code === '23503') return json({ error: 'Data tidak memenuhi aturan (cek layanan_id / format)' }, 400);
    console.error('[admin/petugas POST] insert petugas gagal', insErr?.message);
    return json({ error: 'Gagal menyimpan akun' }, 500);
  }

  await audit(service, actor, 'akun_buat', baris.id, { username, role: b.role, layanan_id: layananId });
  return json({ ok: true, id: baris.id, username, sandi_sementara: sandi, wajib_ganti_sandi: true }, 201);
}
