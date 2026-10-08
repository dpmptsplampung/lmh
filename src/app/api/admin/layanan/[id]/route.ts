import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { json, requireAdmin } from '@/lib/akun/server';
import { determineFormType } from '@/lib/pelayanan';

export const dynamic = 'force-dynamic';

const schema = z
  .object({
    nama: z.string().trim().min(2).max(100),
    nomor_loket: z.string().trim().min(1).max(20).nullable(),
    prefiks: z.string().trim().toUpperCase().regex(/^[A-Z]{1,3}$/, 'Prefiks 1-3 huruf').nullable(),
    status_tampilan: z.enum(['aktif', 'coming_soon', 'nonaktif']),
    tampil_di_layar: z.boolean(),
    punya_antrean: z.boolean(),
    punya_chat: z.boolean(),
  })
  .partial()
  .strict();

type Ctx = { params: Promise<{ id: string }> };

// PATCH pengaturan layanan (Admin aktif). Ditulis lewat sesi Admin sendiri (RLS layanan_admin_all)
// agar trigger audit_perubahan mencatat pelaku + nilai lama -> baru. Bot hidup/mati ada di /bot.
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return json({ error: 'id tidak valid' }, 400);

  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return json({ error: 'Invalid input', details: parsed.success ? {} : parsed.error.flatten().fieldErrors }, 400);
  }
  const { prefiks, ...rest } = parsed.data;
  const upd: Record<string, unknown> = { ...rest };
  if (prefiks !== undefined) upd.prefiks_antrean = prefiks;

  const supabase = await createClient();

  // Nama layanan menentukan jenis form pendataan (determineFormType: substring "oss"/"perizinan").
  // Rename yang mengubah jenis itu memutus pendataan tiket -> ditolak di server.
  if (typeof upd.nama === 'string') {
    const { data: lama } = await supabase.from('layanan').select('nama').eq('id', id).maybeSingle();
    if (lama && determineFormType(lama.nama as string) !== determineFormType(upd.nama)) {
      return json({
        error: 'Nama baru mengubah jenis form pendataan (OSS/Perizinan) layanan ini. Pertahankan kata "OSS"/"Non OSS"/"Perizinan" pada nama, atau minta pengembang menyesuaikan.',
        kode: 'RENAME_UBAH_JENIS_FORM',
      }, 422);
    }
  }

  const { data, error } = await supabase.from('layanan').update(upd).eq('id', id).select('id').maybeSingle();
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === '23505') return json({ error: 'Nama atau prefiks sudah dipakai layanan lain' }, 409);
    console.error('[admin/layanan PATCH] gagal', error.message);
    return json({ error: 'Gagal menyimpan perubahan' }, 500);
  }
  if (!data) return json({ error: 'Layanan tidak ditemukan' }, 404);
  return json({ ok: true });
}
