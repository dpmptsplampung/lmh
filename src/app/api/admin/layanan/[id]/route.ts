import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { MutasiError, mutasiWajibBaris } from '@/lib/supabase/mutate';
import { catatMutasiGagal, kodeDbMutasi, pesanDbMutasi } from '@/app/api/admin/_mutasi';
import { json, requireAdmin } from '@/lib/akun/server';
import { determineFormType } from '@/lib/pelayanan';

export const dynamic = 'force-dynamic';

// Prefiks antrean (migrasi 202610140003): TEPAT 2 huruf A-Z (CHECK ^[A-Z]{2}$ + UNIQUE di DB). Kosong / null = minta kode
// otomatis (trigger trg_layanan_isi_prefiks). Huruf kecil diubah ke kapital; 1 atau 3 huruf, angka, atau simbol ditolak.
const PESAN_PREFIKS = 'Prefiks antrean harus tepat 2 huruf (A-Z), atau dikosongkan agar dibuat otomatis';
const prefiksSchema = z
  .string()
  .trim()
  .toUpperCase()
  .transform((v) => (v === '' ? null : v))
  .pipe(z.string().regex(/^[A-Z]{2}$/, PESAN_PREFIKS).nullable())
  .nullable();

const schema = z
  .object({
    nama: z.string().trim().min(2).max(100),
    nomor_loket: z.string().trim().min(1).max(20).nullable(),
    prefiks: prefiksSchema,
    status_tampilan: z.enum(['aktif', 'coming_soon', 'nonaktif']),
    tampil_di_layar: z.boolean(),
    punya_antrean: z.boolean(),
    punya_chat: z.boolean(),
    // Formulir Pendataan wajib saat layanan diselesaikan (migrasi 202610140012; ditegakkan layanan_selesai).
    form_pendataan: z.enum(['oss', 'perizinan']).nullable(),
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
    const details = parsed.success ? {} : parsed.error.flatten().fieldErrors;
    // Galat prefiks dijelaskan langsung (form menampilkannya di bawah isian prefiks).
    const galatPrefiks = (details as Record<string, string[] | undefined>).prefiks?.[0];
    return json({ error: galatPrefiks ?? 'Invalid input', details }, 400);
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

  try {
    await mutasiWajibBaris(supabase.from('layanan').update(upd).eq('id', id).select('id'));
  } catch (e) {
    if (!(e instanceof MutasiError)) throw e;
    // 0 baris (id salah / RLS) = 404 (kontrak lama).
    if (e.kode === 'tidak_ada_baris') return json({ error: 'Layanan tidak ditemukan' }, 404);
    const kodeDb = kodeDbMutasi(e);
    const pesanDb = pesanDbMutasi(e);
    // 23505 = UNIQUE (nama / uq_layanan_prefiks_antrean): bentrok dengan layanan lain.
    if (kodeDb === '23505') {
      if (/prefiks/i.test(pesanDb)) {
        return json({ error: 'Prefiks antrean sudah dipakai layanan lain. Pilih 2 huruf yang berbeda.', kode: 'PREFIKS_BENTROK' }, 409);
      }
      return json({ error: 'Nama atau prefiks sudah dipakai layanan lain' }, 409);
    }
    // 23514 = CHECK: format prefiks ditolak DB (lapis kedua di balik zod).
    if (kodeDb === '23514' && /prefiks/i.test(pesanDb)) {
      return json({ error: PESAN_PREFIKS, kode: 'PREFIKS_FORMAT' }, 422);
    }
    catatMutasiGagal('/api/admin/layanan/[id]', 'admin.layanan.ubah', e, { layananId: id });
    return json({ error: 'Gagal menyimpan perubahan' }, 500);
  }
  return json({ ok: true });
}
