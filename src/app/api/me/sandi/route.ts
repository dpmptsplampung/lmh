import type { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { ambilJatah, audit, getServiceClient, json, requireStaf } from '@/lib/akun/server';

export const dynamic = 'force-dynamic';

const schema = z
  .object({
    sandi_lama: z.string().min(1).max(200),
    sandi_baru: z.string().min(8).max(72),
    keluarkan_perangkat_lain: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.sandi_baru !== v.sandi_lama, { message: 'Sandi baru harus berbeda', path: ['sandi_baru'] });

// Ubah sandi sendiri: sandi lama diverifikasi dengan klien sementara (tanpa menyimpan sesi).
export async function POST(request: NextRequest) {
  const g = await requireStaf();
  if ('res' in g) return g.res;
  const { supabase, user, me } = g;

  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors }, 400);

  const service = getServiceClient();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!service || !url || !anon || !user.email) return json({ error: 'Server misconfigured' }, 500);

  if (!(await ambilJatah(service, `akun_sandi:${me.id}`, 5, 900))) {
    return json({ error: 'Terlalu banyak percobaan. Coba lagi dalam beberapa menit.' }, 429);
  }

  const temp = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: lamaErr } = await temp.auth.signInWithPassword({ email: user.email, password: parsed.data.sandi_lama });
  if (lamaErr) return json({ error: 'Sandi lama salah' }, 400);

  const { error } = await service.auth.admin.updateUserById(user.id, { password: parsed.data.sandi_baru });
  if (error) {
    console.error('[me/sandi] updateUserById gagal', error.message);
    return json({ error: 'Gagal mengubah sandi (mungkin terlalu lemah)' }, 400);
  }
  await service.from('petugas').update({ wajib_ganti_sandi: false }).eq('id', me.id);
  if (parsed.data.keluarkan_perangkat_lain) await supabase.auth.signOut({ scope: 'others' });
  await audit(service, { id: me.id, role: me.role }, 'akun_ganti_sandi_sendiri', me.id, {
    perangkat_lain_dikeluarkan: !!parsed.data.keluarkan_perangkat_lain,
  });
  return json({ ok: true });
}
