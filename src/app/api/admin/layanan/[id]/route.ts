import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { MutasiError, mutasiWajibBaris } from '@/lib/supabase/mutate';
import { catatMutasiGagal, kodeDbMutasi } from '@/app/api/admin/_mutasi';
import { json, requireAdmin } from '@/lib/akun/server';
import { layananUbahSchema } from '@/lib/layanan/schemas';
import { petaGalatTulisLayanan } from '../_galat';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// PATCH pengaturan & konten layanan (Admin aktif). Ditulis lewat sesi Admin sendiri (RLS layanan_admin_all)
// agar trigger audit_perubahan mencatat pelaku + nilai lama -> baru. Bot hidup/mati ada di /bot; arsip di /arsip.
// Ganti nama BEBAS: form pendataan tidak lagi ditebak dari nama (field form_pendataan eksplisit).
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return json({ error: 'id tidak valid' }, 400);

  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const parsed = layananUbahSchema.safeParse(raw);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    const details = parsed.success ? {} : parsed.error.flatten().fieldErrors;
    // Galat prefiks dijelaskan langsung (form menampilkannya di bawah isian prefiks).
    const galatPrefiks = (details as Record<string, string[] | undefined>).prefiks?.[0];
    return json({ error: galatPrefiks ?? 'Invalid input', details }, 400);
  }
  const { prefiks, ...rest } = parsed.data;
  const upd: Record<string, unknown> = { ...rest };
  if (prefiks !== undefined) upd.prefiks_antrean = prefiks;

  const supabase = await createClient();

  // konten_diperbarui_at hanya dicap bila deskripsi / sumber konten benar-benar BERUBAH (form mengirim semua field).
  if ('deskripsi' in upd || 'konten_sumber_url' in upd) {
    const { data: lama, error: errLama } = await supabase
      .from('layanan').select('deskripsi, konten_sumber_url').eq('id', id).maybeSingle();
    if (errLama) {
      console.error('[admin/layanan PATCH] gagal membaca data lama', errLama.message);
      return json({ error: 'Gagal menyimpan perubahan' }, 500);
    }
    if (!lama) return json({ error: 'Layanan tidak ditemukan' }, 404);
    const berubah =
      ('deskripsi' in upd && upd.deskripsi !== (lama.deskripsi ?? null)) ||
      ('konten_sumber_url' in upd && upd.konten_sumber_url !== (lama.konten_sumber_url ?? null));
    if (berubah) upd.konten_diperbarui_at = new Date().toISOString();
  }

  try {
    await mutasiWajibBaris(supabase.from('layanan').update(upd).eq('id', id).select('id'));
  } catch (e) {
    if (!(e instanceof MutasiError)) throw e;
    // 0 baris (id salah / RLS) = 404 (kontrak lama).
    if (e.kode === 'tidak_ada_baris') return json({ error: 'Layanan tidak ditemukan' }, 404);
    const galat = petaGalatTulisLayanan(e);
    if (galat) return json(galat.body, galat.status);
    catatMutasiGagal('/api/admin/layanan/[id]', 'admin.layanan.ubah', e, { layananId: id });
    return json({ error: 'Gagal menyimpan perubahan' }, 500);
  }
  return json({ ok: true });
}

// Tabel yang merujuk layanan dan TIDAK boleh kehilangan induknya. kunjungan.layanan_saran_id ON DELETE SET NULL
// akan diam-diam mengubah baris lama, jadi dicek di sini (bukan diserahkan ke FK).
const RUJUKAN_LAYANAN: Array<{ tabel: string; kolom: string }> = [
  { tabel: 'tiket_antrean', kolom: 'layanan_id' },
  { tabel: 'penanganan', kolom: 'layanan_id' },
  { tabel: 'chat_sesi', kolom: 'layanan_id' },
  { tabel: 'kunjungan', kolom: 'layanan_saran_id' },
];

// DELETE layanan (Admin). Hanya layanan yang belum pernah dipakai; yang sudah dipakai harus diarsipkan.
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return json({ error: 'id tidak valid' }, 400);

  const supabase = await createClient();
  const sudahDipakai = () => json({
    error: 'Layanan sudah pernah dipakai (tiket, penanganan, chat, atau kunjungan). Arsipkan saja, jangan dihapus.',
    kode: 'SUDAH_DIPAKAI',
  }, 409);

  for (const { tabel, kolom } of RUJUKAN_LAYANAN) {
    const { count, error } = await supabase.from(tabel).select('id', { count: 'exact', head: true }).eq(kolom, id);
    if (error) {
      console.error('[admin/layanan DELETE] gagal memeriksa pemakaian', tabel, error.message);
      return json({ error: 'Gagal memeriksa pemakaian layanan' }, 500);
    }
    if ((count ?? 0) > 0) return sudahDipakai();
  }

  try {
    await mutasiWajibBaris(supabase.from('layanan').delete().eq('id', id).select('id'));
  } catch (e) {
    if (!(e instanceof MutasiError)) throw e;
    if (e.kode === 'tidak_ada_baris') return json({ error: 'Layanan tidak ditemukan' }, 404);
    // 23503 = FK: ada rujukan yang muncul di antara pemeriksaan dan penghapusan (atau tabel lain yang tak terdaftar).
    if (kodeDbMutasi(e) === '23503') return sudahDipakai();
    catatMutasiGagal('/api/admin/layanan/[id]', 'admin.layanan.hapus', e, { layananId: id });
    return json({ error: 'Gagal menghapus layanan' }, 500);
  }
  return json({ ok: true });
}
