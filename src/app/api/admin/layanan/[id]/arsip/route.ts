import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { MutasiError, mutasiWajibBaris } from '@/lib/supabase/mutate';
import { catatMutasiGagal } from '@/app/api/admin/_mutasi';
import { json, requireAdmin } from '@/lib/akun/server';
import { arsipSchema } from '@/lib/layanan/schemas';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// POST arsipkan / pulihkan layanan (Admin). Arsip = aktif=false + diarsipkan_at=now(); semua gerbang jadwal
// menganggap aktif=false sebagai tutup. Pulihkan = aktif=true + diarsipkan_at=null.
export async function POST(request: NextRequest, { params }: Ctx) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return json({ error: 'id tidak valid' }, 400);

  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const parsed = arsipSchema.safeParse(raw);
  if (!parsed.success) return json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors }, 400);
  const { arsip } = parsed.data;

  const supabase = await createClient();
  try {
    await mutasiWajibBaris(
      supabase.from('layanan')
        .update({ aktif: !arsip, diarsipkan_at: arsip ? new Date().toISOString() : null })
        .eq('id', id)
        .select('id'),
    );
  } catch (e) {
    if (!(e instanceof MutasiError)) throw e;
    if (e.kode === 'tidak_ada_baris') return json({ error: 'Layanan tidak ditemukan' }, 404);
    catatMutasiGagal('/api/admin/layanan/[id]/arsip', arsip ? 'admin.layanan.arsip' : 'admin.layanan.pulihkan', e, { layananId: id });
    return json({ error: 'Gagal mengubah status arsip' }, 500);
  }
  return json({ ok: true });
}
