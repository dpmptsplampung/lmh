import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { MutasiError, mutasiInsert } from '@/lib/supabase/mutate';
import { catatMutasiGagal, kodeDbMutasi } from '@/app/api/admin/_mutasi';
import { json, requireAdmin, requireStaf } from '@/lib/akun/server';
import { instansiBuatSchema, type InstansiRow } from '@/lib/layanan/schemas';

export const dynamic = 'force-dynamic';

// GET daftar instansi. Admin: kelola; Front Office: hanya lihat. Petugas: ditolak.
export async function GET() {
  const g = await requireStaf();
  if ('res' in g) return g.res;
  if (g.me.role !== 'admin' && g.me.role !== 'front_office') return json({ error: 'Forbidden' }, 403);

  const supabase = await createClient();
  const { data, error } = await supabase.from('instansi').select('id, nama, singkatan').order('nama');
  if (error) {
    console.error('[admin/instansi GET] gagal', error.message);
    return json({ error: 'Gagal memuat instansi' }, 500);
  }
  return json({ instansi: (data ?? []) as InstansiRow[], bisa_ubah: g.me.role === 'admin' });
}

// POST buat instansi (Admin). Ditulis lewat sesi Admin sendiri agar trigger audit mencatat pelaku.
export async function POST(request: NextRequest) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;

  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const parsed = instansiBuatSchema.safeParse(raw);
  if (!parsed.success) return json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors }, 400);

  const supabase = await createClient();
  try {
    const dibuat = await mutasiInsert<{ id: string }>(
      supabase.from('instansi').insert({ nama: parsed.data.nama, singkatan: parsed.data.singkatan ?? null }).select('id').single(),
    );
    if (!dibuat[0]) return json({ error: 'Gagal membuat instansi' }, 500);
    return json({ id: dibuat[0].id }, 201);
  } catch (e) {
    if (!(e instanceof MutasiError)) throw e;
    if (kodeDbMutasi(e) === '23505') return json({ error: 'Nama instansi sudah dipakai', kode: 'NAMA_BENTROK' }, 409);
    catatMutasiGagal('/api/admin/instansi', 'admin.instansi.buat', e);
    return json({ error: 'Gagal membuat instansi' }, 500);
  }
}
