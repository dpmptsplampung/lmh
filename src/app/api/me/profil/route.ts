import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { getServiceClient, json, kirimVerifikasiEmail, requireStaf } from '@/lib/akun/server';
import { normalizeNoHp } from '@/lib/akun/login';

export const dynamic = 'force-dynamic';

const schema = z
  .object({
    no_hp: z.string().trim().nullable(),
    email_notifikasi: z.email().max(254).nullable(),
    operator_default: z.string().trim().min(2).max(100).nullable(),
  })
  .partial()
  .strict();

export async function GET() {
  const g = await requireStaf();
  if ('res' in g) return g.res;
  const { me } = g;
  const layanan = me.layanan;
  return json({
    profil: {
      id: me.id,
      nama: me.nama,
      username: me.username,
      role: me.role,
      layanan_id: me.layanan_id,
      layanan_nama: (Array.isArray(layanan) ? layanan[0]?.nama : layanan?.nama) ?? null,
      no_hp: me.no_hp,
      email_notifikasi: me.email_notifikasi,
      email_notifikasi_terverifikasi: !!me.email_notifikasi && !!me.email_notifikasi_verified_at,
      operator_default: me.operator_default,
      wajib_ganti_sandi: me.wajib_ganti_sandi,
    },
  });
}

// Hanya no_hp, email_notifikasi, operator_default; lewat RPC petugas_ubah_profil (pemanggil = sesi sendiri).
export async function PATCH(request: NextRequest) {
  const g = await requireStaf();
  if ('res' in g) return g.res;
  const { supabase, me } = g;

  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return json({ error: 'Invalid input', details: parsed.success ? {} : parsed.error.flatten().fieldErrors }, 400);
  }
  const patch: Record<string, string | null> = { ...parsed.data };
  if (parsed.data.no_hp) {
    const n = normalizeNoHp(parsed.data.no_hp);
    if (!n) return json({ error: 'Format nomor HP tidak valid' }, 400);
    patch.no_hp = n;
  }
  const emailBaru = parsed.data.email_notifikasi?.toLowerCase() ?? null;
  if (parsed.data.email_notifikasi) patch.email_notifikasi = emailBaru;

  const { error } = await supabase.rpc('petugas_ubah_profil', { p_patch: patch });
  if (error) {
    console.error('[me/profil PATCH] rpc gagal', error.message);
    return json({ error: error.code === '42501' ? 'Akses ditolak' : 'Gagal menyimpan profil' }, error.code === '42501' ? 403 : 400);
  }

  let verifikasiDikirim = false;
  if (emailBaru && emailBaru !== me.email_notifikasi) {
    const service = getServiceClient();
    verifikasiDikirim = !!service && (await kirimVerifikasiEmail(service, me.id, emailBaru));
  }
  return json({ ok: true, verifikasi_dikirim: verifikasiDikirim });
}
