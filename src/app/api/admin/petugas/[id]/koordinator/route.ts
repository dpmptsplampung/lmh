import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { audit, json, requireAdmin } from '@/lib/akun/server';
import { MutasiError, mutasiWajibBaris } from '@/lib/supabase/mutate';
import { catatMutasiGagal } from '@/app/api/admin/_mutasi';
import { KODE_MIGRASI_BELUM, objekBelumAda } from '@/lib/akses-data/galat';

export const dynamic = 'force-dynamic';

const schema = z.object({ koordinator: z.boolean() }).strict();

type Ctx = { params: Promise<{ id: string }> };

// PATCH penanda Koordinator (Fase 3, spec §6.1, ADR 0003). Hanya Admin aktif; hanya akun Front Office atau Petugas
// Layanan (penanda bukan role; role tidak berubah). Tercatat di audit_log (akun_koordinator).
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const { actor, service } = g;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return json({ error: 'id tidak valid' }, 400);

  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors }, 400);
  const { koordinator } = parsed.data;

  const { data: target } = await service.from('petugas').select('id, role, aktif').eq('id', id).maybeSingle();
  if (!target) return json({ error: 'Akun tidak ditemukan' }, 404);
  if (target.role !== 'front_office' && target.role !== 'petugas') {
    return json({ error: 'Penanda Koordinator hanya untuk akun Front Office atau Petugas Layanan' }, 400);
  }

  try {
    await mutasiWajibBaris(service.from('petugas').update({ koordinator }).eq('id', id).select('id'));
  } catch (e) {
    if (!(e instanceof MutasiError)) throw e;
    if (objekBelumAda(e.asal)) {
      return json({ error: 'Penanda Koordinator belum tersedia: migrasi 202610290001 belum diterapkan.', kode: KODE_MIGRASI_BELUM }, 409);
    }
    if (e.kode === 'tidak_ada_baris') return json({ error: 'Akun tidak ditemukan' }, 404);
    catatMutasiGagal('/api/admin/petugas/[id]/koordinator', 'admin.petugas.koordinator', e, { petugasId: id });
    return json({ error: 'Gagal menyimpan penanda Koordinator' }, 500);
  }

  await audit(service, actor, 'akun_koordinator', id, { role: target.role, koordinator });
  return json({ ok: true, koordinator });
}
