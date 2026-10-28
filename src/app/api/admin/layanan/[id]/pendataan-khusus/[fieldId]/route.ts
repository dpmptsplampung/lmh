import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { mutasiWajibBaris } from '@/lib/supabase/mutate';
import { json, requireAdmin } from '@/lib/akun/server';
import { petaFieldKhusus } from '@/lib/pendataan-khusus/jenis';
import { fieldUbahSchema } from '@/lib/pendataan-khusus/schemas';
import { responsGalatKhusus } from '../_galat';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; fieldId: string }> };
const ROUTE = '/api/admin/layanan/[id]/pendataan-khusus/[fieldId]';

// PATCH: label, wajib, opsi, tersembunyi (jenis TIDAK dapat diubah: tidak ada di skema; DB juga menolak untuk isian yang
// pernah diisi). DELETE: hanya isian yang belum pernah diisi (trigger DB; yang pernah diisi cukup disembunyikan).
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const { id, fieldId } = await params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(fieldId).success) return json({ error: 'id tidak valid' }, 400);
  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const parsed = fieldUbahSchema.safeParse(raw);
  if (!parsed.success) return json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors }, 422);

  const supabase = await createClient();
  try {
    const [baris] = await mutasiWajibBaris(
      supabase
        .from('pendataan_khusus_field')
        .update(parsed.data)
        .eq('id', fieldId)
        .eq('layanan_id', id)
        .select('id, layanan_id, label, jenis, wajib, opsi, urut, tersembunyi, pernah_diisi'),
    );
    return json({ isian: petaFieldKhusus((baris ?? {}) as Record<string, unknown>) });
  } catch (e) {
    return responsGalatKhusus(e, ROUTE, 'admin.pendataan_khusus.ubah');
  }
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const { id, fieldId } = await params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(fieldId).success) return json({ error: 'id tidak valid' }, 400);

  const supabase = await createClient();
  try {
    await mutasiWajibBaris(
      supabase.from('pendataan_khusus_field').delete().eq('id', fieldId).eq('layanan_id', id).select('id'),
    );
  } catch (e) {
    return responsGalatKhusus(e, ROUTE, 'admin.pendataan_khusus.hapus');
  }
  return json({ ok: true });
}
