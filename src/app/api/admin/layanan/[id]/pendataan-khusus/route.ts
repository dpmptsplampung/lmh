import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { mutasiInsert } from '@/lib/supabase/mutate';
import { json, requireAdmin } from '@/lib/akun/server';
import { petaFieldKhusus } from '@/lib/pendataan-khusus/jenis';
import { fieldBaruSchema, urutanSchema } from '@/lib/pendataan-khusus/schemas';
import { responsGalatKhusus } from './_galat';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };
const ROUTE = '/api/admin/layanan/[id]/pendataan-khusus';

// Pendataan Khusus per Layanan (Admin, spec §7). Tulis lewat klien pengguna: RLS pendataan_khusus_field_admin_* dan
// trigger DB (jenis terkunci / tidak dapat dihapus bila pernah diisi / Layanan ber-formulir tetap) adalah penegak akhir.

async function layananAda(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data, error } = await supabase.from('layanan').select('id, form_pendataan').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return data as { id: string; form_pendataan: string | null };
}

export async function GET(_request: NextRequest, { params }: Ctx) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return json({ error: 'id tidak valid' }, 400);
  const supabase = await createClient();
  const layanan = await layananAda(supabase, id);
  if (!layanan) return json({ error: 'Layanan tidak ditemukan' }, 404);
  const { data, error } = await supabase
    .from('pendataan_khusus_field')
    .select('id, layanan_id, label, jenis, wajib, opsi, urut, tersembunyi, pernah_diisi')
    .eq('layanan_id', id)
    .order('urut')
    .order('created_at');
  if (error) return responsGalatKhusus(error, ROUTE, 'admin.pendataan_khusus.daftar');
  return json({
    form_tetap: layanan.form_pendataan !== null,
    isian: ((data ?? []) as Record<string, unknown>[]).map(petaFieldKhusus),
  });
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return json({ error: 'id tidak valid' }, 400);
  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const parsed = fieldBaruSchema.safeParse(raw);
  if (!parsed.success) return json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors }, 422);

  const supabase = await createClient();
  const layanan = await layananAda(supabase, id);
  if (!layanan) return json({ error: 'Layanan tidak ditemukan' }, 404);

  try {
    const [baris] = await mutasiInsert(
      supabase
        .from('pendataan_khusus_field')
        .insert({ layanan_id: id, ...parsed.data })
        .select('id, layanan_id, label, jenis, wajib, opsi, urut, tersembunyi, pernah_diisi'),
    );
    return json({ isian: petaFieldKhusus((baris ?? {}) as Record<string, unknown>) }, 201);
  } catch (e) {
    return responsGalatKhusus(e, ROUTE, 'admin.pendataan_khusus.tambah');
  }
}

// PUT {urutan: uuid[]}: urut = indeks. Id di luar Layanan ini / bukan Admin -> 404 (ISIAN_TIDAK_DITEMUKAN).
export async function PUT(request: NextRequest, { params }: Ctx) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return json({ error: 'id tidak valid' }, 400);
  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const parsed = urutanSchema.safeParse(raw);
  if (!parsed.success) return json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors }, 422);

  // Satu RPC = satu pernyataan UPDATE: seluruh urutan berhasil atau tidak sama sekali (migrasi 202610300001).
  const supabase = await createClient();
  const { error } = await supabase.rpc('pendataan_khusus_urutkan', { p_layanan: id, p_urutan: parsed.data.urutan });
  if (error) return responsGalatKhusus(error, ROUTE, 'admin.pendataan_khusus.urutan');
  return json({ ok: true, jumlah: parsed.data.urutan.length });
}
