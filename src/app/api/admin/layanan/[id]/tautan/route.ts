import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { MutasiError, mutasiBolehKosong, mutasiInsert, mutasiWajibBaris } from '@/lib/supabase/mutate';
import { catatMutasiGagal } from '@/app/api/admin/_mutasi';
import { json, requireAdmin } from '@/lib/akun/server';
import { tautanDaftarSchema } from '@/lib/layanan/schemas';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// PUT ganti seluruh daftar website terkait milik layanan (Admin): hapus baris lama, sisipkan yang baru (urut = indeks).
// Klien Supabase tidak punya transaksi: bila INSERT gagal setelah DELETE, daftar lama hilang (500 + tercatat di log);
// Admin cukup menyimpan ulang. Layanan dipastikan ada (dan konten_diperbarui_at dicap) SEBELUM menghapus apa pun.
export async function PUT(request: NextRequest, { params }: Ctx) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return json({ error: 'id tidak valid' }, 400);

  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const parsed = tautanDaftarSchema.safeParse(raw);
  if (!parsed.success) return json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors }, 400);
  const { tautan } = parsed.data;

  const supabase = await createClient();
  try {
    await mutasiWajibBaris(
      supabase.from('layanan').update({ konten_diperbarui_at: new Date().toISOString() }).eq('id', id).select('id'),
    );
  } catch (e) {
    if (!(e instanceof MutasiError)) throw e;
    if (e.kode === 'tidak_ada_baris') return json({ error: 'Layanan tidak ditemukan' }, 404);
    catatMutasiGagal('/api/admin/layanan/[id]/tautan', 'admin.layanan.tautan.stempel', e, { layananId: id });
    return json({ error: 'Gagal menyimpan website terkait' }, 500);
  }

  try {
    await mutasiBolehKosong(supabase.from('layanan_tautan').delete().eq('layanan_id', id).select('id'));
    if (tautan.length > 0) {
      await mutasiInsert(
        supabase.from('layanan_tautan').insert(tautan.map((t, urut) => ({ layanan_id: id, label: t.label, url: t.url, urut }))),
      );
    }
  } catch (e) {
    if (!(e instanceof MutasiError)) throw e;
    catatMutasiGagal('/api/admin/layanan/[id]/tautan', 'admin.layanan.tautan.ganti', e, { layananId: id });
    return json({ error: 'Gagal menyimpan website terkait' }, 500);
  }
  return json({ ok: true, jumlah: tautan.length });
}
