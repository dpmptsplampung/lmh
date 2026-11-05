import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getServiceClient, json, kirimVerifikasiEmail, requireStaf, type Staf } from '@/lib/akun/server';
import { isSyntheticEmail, normalizeNoHp } from '@/lib/akun/login';
import { KODE_MIGRASI_BELUM, objekBelumAda } from '@/lib/akses-data/galat';

export const dynamic = 'force-dynamic';

const schema = z
  .object({
    nama: z.string().refine((s) => !/[\p{Cc}\p{Cf}]/u.test(s), 'Nama tidak boleh mengandung karakter kontrol')
      .transform((s) => s.trim()).pipe(z.string().min(2).max(100).regex(/^[^=+@-]/u)),
    no_hp: z.string().trim().nullable(),
    email_notifikasi: z.string().trim().pipe(z.email().max(254)).nullable(),
    operator_default: z.string().trim().min(2).max(100).nullable(),
  })
  .partial()
  .strict();

function profilPublik(me: Staf, operatorAktif: boolean) {
  const layanan = me.layanan;
  return {
    id: me.id,
    nama: me.nama,
    username: me.username,
    role: me.role,
    layanan_id: me.layanan_id,
    layanan_nama: (Array.isArray(layanan) ? layanan[0]?.nama : layanan?.nama) ?? null,
    no_hp: me.no_hp,
    email_notifikasi: me.email_notifikasi,
    email_notifikasi_terverifikasi: !!me.email_notifikasi && !!me.email_notifikasi_verified_at,
    operator_default: me.operator_default,
    operator_aktif: operatorAktif,
    wajib_ganti_sandi: me.wajib_ganti_sandi,
  };
}

async function bacaOperator(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase.from('petugas').select('operator_aktif').eq('id', id).maybeSingle();
  return { aktif: data?.operator_aktif === true, belum: objekBelumAda(error), error };
}

export async function GET() {
  const g = await requireStaf();
  if ('res' in g) return g.res;
  const flag = await bacaOperator(g.supabase, g.me.id);
  if (flag.error && !flag.belum) return json({ error: 'Gagal memuat profil' }, 500);
  return json({ profil: profilPublik(g.me, flag.aktif) });
}

// Pemanggil selalu sesi sendiri; nama dan audit ditulis atomik di database.
export async function PATCH(request: NextRequest) {
  const g = await requireStaf();
  if ('res' in g) return g.res;
  const { supabase, me } = g;

  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'Data JSON tidak valid' }, 400); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return json({ error: 'Isian profil tidak valid', ...(!parsed.success ? { field: parsed.error.issues[0]?.path[0] } : {}),
      details: parsed.success ? {} : parsed.error.flatten().fieldErrors }, 400);
  }
  const patch: Record<string, string | null> = { ...parsed.data };
  if (parsed.data.no_hp) {
    const n = normalizeNoHp(parsed.data.no_hp);
    if (!n) return json({ error: 'Format nomor HP tidak valid', field: 'no_hp' }, 400);
    patch.no_hp = n;
  }
  if (parsed.data.no_hp === '') patch.no_hp = null;
  const emailBaru = parsed.data.email_notifikasi?.toLowerCase() ?? null;
  if (parsed.data.email_notifikasi) patch.email_notifikasi = emailBaru;

  const flag = await bacaOperator(supabase, me.id);
  if (flag.error && !flag.belum) return json({ error: 'Gagal memuat profil' }, 500);
  if (flag.belum && (patch.nama !== undefined || patch.operator_default !== undefined)) {
    return json({ error: 'Perubahan nama dan operator belum tersedia', kode: KODE_MIGRASI_BELUM }, 409);
  }
  if (patch.operator_default !== undefined && !flag.aktif) {
    return json({ error: 'Isian operator belum diaktifkan oleh Admin', field: 'operator_default' }, 403);
  }
  if (emailBaru && (isSyntheticEmail(emailBaru) || /\.internal$/i.test(emailBaru))) {
    return json({ error: 'Gunakan alamat email notifikasi yang nyata', field: 'email_notifikasi' }, 400);
  }

  const { error } = await supabase.rpc('petugas_ubah_profil', { p_patch: patch });
  if (error) {
    if (objekBelumAda(error)) return json({ error: 'Perubahan profil belum tersedia', kode: KODE_MIGRASI_BELUM }, 409);
    if (error.code === '22023' && ['nama', 'no_hp', 'email_notifikasi', 'operator_default'].includes(error.details)) {
      const pesan = error.details === 'email_notifikasi' ? 'Gunakan alamat email notifikasi yang nyata' : 'Isian profil tidak valid';
      return json({ error: pesan, field: error.details }, 400);
    }
    console.error('[me/profil PATCH] rpc gagal', error.code);
    return json({ error: error.code === '42501' ? 'Akses ditolak' : 'Gagal menyimpan profil' },
      error.code === '42501' ? 403 : error.code === '22023' || error.code === '23514' ? 400 : 500);
  }

  let verifikasiDikirim = false;
  if (emailBaru && emailBaru !== me.email_notifikasi) {
    const service = getServiceClient();
    verifikasiDikirim = !!service && (await kirimVerifikasiEmail(service, me.id, emailBaru));
  }
  const terbaru = await requireStaf();
  const profil = profilPublik('res' in terbaru ? { ...me, ...patch,
    email_notifikasi_verified_at: emailBaru !== me.email_notifikasi && 'email_notifikasi' in patch ? null : me.email_notifikasi_verified_at,
  } as Staf : terbaru.me, flag.aktif);
  return json({ ok: true, verifikasi_dikirim: verifikasiDikirim, profil });
}
