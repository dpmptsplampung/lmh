import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { MutasiError, mutasiWajibBaris } from '@/lib/supabase/mutate';
import { catatMutasiGagal, kodeDbMutasi } from '@/app/api/admin/_mutasi';
import { json, requireAdmin } from '@/lib/akun/server';
import { instansiUbahSchema } from '@/lib/layanan/schemas';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// PATCH ubah nama/singkatan instansi (Admin). Lewat sesi Admin sendiri (RLS) agar audit mencatat pelaku.
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return json({ error: 'id tidak valid' }, 400);

  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const parsed = instansiUbahSchema.safeParse(raw);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return json({ error: 'Invalid input', details: parsed.success ? {} : parsed.error.flatten().fieldErrors }, 400);
  }

  const supabase = await createClient();
  try {
    await mutasiWajibBaris(supabase.from('instansi').update(parsed.data).eq('id', id).select('id'));
  } catch (e) {
    if (!(e instanceof MutasiError)) throw e;
    if (e.kode === 'tidak_ada_baris') return json({ error: 'Instansi tidak ditemukan' }, 404);
    if (kodeDbMutasi(e) === '23505') return json({ error: 'Nama instansi sudah dipakai', kode: 'NAMA_BENTROK' }, 409);
    catatMutasiGagal('/api/admin/instansi/[id]', 'admin.instansi.ubah', e, { instansiId: id });
    return json({ error: 'Gagal menyimpan perubahan' }, 500);
  }
  return json({ ok: true });
}
