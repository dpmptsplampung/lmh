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

// Tabel yang merujuk layanan dan TIDAK boleh kehilangan induknya. Tiga golongan (FK-nya, diverifikasi di migrasi):
//  - RESTRICT / NO ACTION (tiket_antrean, penanganan, chat_sesi): DB sendiri menolak (23503), dicek di sini agar pesannya jelas.
//  - ON DELETE SET NULL (kunjungan.layanan_saran_id, pengaduan, petugas, dokumen_peraturan): DB DIAM-DIAM menulis ulang
//    baris lama, jadi WAJIB dicek di sini.
//  - ON DELETE CASCADE yang berisi RIWAYAT (rekap_harian_layanan, skm_response_rate): DB diam-diam MENGHAPUS riwayat.
// Tabel konfigurasi yang ikut terhapus (layanan_hari, antrean_counter, topik_penanganan, jadwal_standby/pengecualian/
// harian_beku, standar_pelayanan, faq, layanan_tautan) sengaja diizinkan. Kolom penghitung = kolom FK itu sendiri
// (rekap_harian_layanan & skm_response_rate tidak punya kolom id).
const RUJUKAN_LAYANAN: Array<{ tabel: string; kolom: string }> = [
  { tabel: 'tiket_antrean', kolom: 'layanan_id' },
  { tabel: 'penanganan', kolom: 'layanan_id' },
  { tabel: 'chat_sesi', kolom: 'layanan_id' },
  { tabel: 'kunjungan', kolom: 'layanan_saran_id' },
  { tabel: 'pengaduan', kolom: 'layanan_id' },
  { tabel: 'petugas', kolom: 'layanan_id' },
  { tabel: 'dokumen_peraturan', kolom: 'layanan_id' },
  { tabel: 'rekap_harian_layanan', kolom: 'layanan_id' },
  { tabel: 'skm_response_rate', kolom: 'layanan_id' },
];

// DELETE layanan (Admin). Hanya layanan yang belum pernah dipakai; yang sudah dipakai harus diarsipkan.
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return json({ error: 'id tidak valid' }, 400);

  const supabase = await createClient();
  const sudahDipakai = () => json({
    error: 'Layanan sudah pernah dipakai (tiket, penanganan, chat, kunjungan, pengaduan, petugas, dokumen, atau rekap). Arsipkan saja, jangan dihapus.',
    kode: 'SUDAH_DIPAKAI',
  }, 409);

  const hitung = await Promise.all(
    RUJUKAN_LAYANAN.map(async ({ tabel, kolom }) => ({
      tabel,
      ...(await supabase.from(tabel).select(kolom, { count: 'exact', head: true }).eq(kolom, id)),
    })),
  );
  const gagal = hitung.find((h) => h.error);
  if (gagal) {
    console.error('[admin/layanan DELETE] gagal memeriksa pemakaian', gagal.tabel, gagal.error?.message);
    return json({ error: 'Gagal memeriksa pemakaian layanan' }, 500);
  }
  if (hitung.some((h) => (h.count ?? 0) > 0)) return sudahDipakai();

  try {
    await mutasiWajibBaris(supabase.from('layanan').delete().eq('id', id).select('id'));
  } catch (e) {
    if (!(e instanceof MutasiError)) throw e;
    if (e.kode === 'tidak_ada_baris') return json({ error: 'Layanan tidak ditemukan' }, 404);
    // 23503 = FK RESTRICT/NO ACTION: rujukan yang muncul di antara pemeriksaan dan penghapusan (balapan) atau tabel RESTRICT tak terdaftar.
    if (kodeDbMutasi(e) === '23503') return sudahDipakai();
    catatMutasiGagal('/api/admin/layanan/[id]', 'admin.layanan.hapus', e, { layananId: id });
    return json({ error: 'Gagal menghapus layanan' }, 500);
  }
  return json({ ok: true });
}
