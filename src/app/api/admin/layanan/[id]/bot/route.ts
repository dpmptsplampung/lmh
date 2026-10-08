import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
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
  const { data, error } = await supabase
    .from('layanan')
    .update({ chatbot_aktif: parsed.data.aktif })
    .eq('id', id)
    .select('id, chatbot_aktif')
    .maybeSingle();
  if (error) {
    console.error('[admin/layanan/bot PATCH] gagal', error.message);
    return json({ error: 'Gagal mengubah status bot' }, 500);
  }
  if (!data) return json({ error: 'Layanan tidak ditemukan' }, 404);
  return json({ ok: true, chatbot_aktif: data.chatbot_aktif });
}
