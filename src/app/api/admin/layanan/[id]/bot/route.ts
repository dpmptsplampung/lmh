import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { MutasiError, mutasiWajibBaris } from '@/lib/supabase/mutate';
import { catatMutasiGagal } from '@/app/api/admin/_mutasi';
import { json, requireAdmin } from '@/lib/akun/server';

export const dynamic = 'force-dynamic';

const schema = z.object({ aktif: z.boolean() }).strict();

type Ctx = { params: Promise<{ id: string }> };

// Bot hidup/mati per layanan = Admin saja (keputusan CEO). Lewat sesi Admin (RLS) agar audit mencatat pelaku.
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return json({ error: 'id tidak valid' }, 400);

  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors }, 400);

  const supabase = await createClient();
  try {
    const [baris] = await mutasiWajibBaris<{ id: string; chatbot_aktif: boolean }>(
      supabase.from('layanan').update({ chatbot_aktif: parsed.data.aktif }).eq('id', id).select('id, chatbot_aktif'),
    );
    return json({ ok: true, chatbot_aktif: baris.chatbot_aktif });
  } catch (e) {
    if (!(e instanceof MutasiError)) throw e;
    // 0 baris (id salah / RLS) = 404 (kontrak lama); selain itu 500 generik.
    if (e.kode === 'tidak_ada_baris') return json({ error: 'Layanan tidak ditemukan' }, 404);
    catatMutasiGagal('/api/admin/layanan/[id]/bot', 'admin.layanan.bot', e, { layananId: id });
    return json({ error: 'Gagal mengubah status bot' }, 500);
  }
}
