import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { audit, json, requireAdmin } from '@/lib/akun/server';
import { MutasiError, mutasiInsert, mutasiWajibBaris } from '@/lib/supabase/mutate';
import { catatMutasiGagal, kodeDbMutasi, pesanDbMutasi } from '@/app/api/admin/_mutasi';
import { objekBelumAda } from '@/lib/akses-data/galat';
import { isSyntheticEmail, isValidUsername, normalizeNoHp, normalizeUsername, usernameToEmail } from '@/lib/akun/login';

export const dynamic = 'force-dynamic';

const schema = z
  .object({
    nama: z.string().trim().min(2).max(200),
    no_hp: z.string().trim().nullable(),
    layanan_id: z.uuid().nullable(),
    username: z.string(),
    email_notifikasi: z.email().max(254).nullable(),
    role: z.enum(['admin', 'front_office', 'petugas']),
    email_login: z.email().max(254),
  })
  .partial()
  .strict();

type Ctx = { params: Promise<{ id: string }> };

// PATCH edit akun layanan (Admin). Urutan: tulis petugas (unik username dijaga DB) -> sinkron Auth -> bila gagal batalkan.
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const { actor, service } = g;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return json({ error: 'id tidak valid' }, 400);

  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return json({ error: 'Invalid input', details: parsed.success ? {} : parsed.error.flatten().fieldErrors }, 400);
  }
  const b = parsed.data;

  const { data: target } = await service
    .from('petugas')
    .select('id, auth_user_id, role, layanan_id, username, email_notifikasi')
    .eq('id', id)
    .maybeSingle();
  if (!target) return json({ error: 'Akun tidak ditemukan' }, 404);
  const self = target.id === actor.id;

  // ---- validasi aturan ----
  const upd: Record<string, unknown> = {};
  if (b.nama !== undefined) upd.nama = b.nama;
  if (b.no_hp !== undefined) {
    const n = b.no_hp === null || b.no_hp === '' ? null : normalizeNoHp(b.no_hp);
    if (b.no_hp && !n) return json({ error: 'Format nomor HP tidak valid' }, 400);
    upd.no_hp = n;
  }
  if (b.layanan_id !== undefined) upd.layanan_id = b.layanan_id;
  if (b.role !== undefined && b.role !== target.role) {
    if (self) return json({ error: 'Tidak boleh mengubah role akun sendiri' }, 403);
    upd.role = b.role;
  }
  const roleAkhir = (upd.role as string | undefined) ?? target.role;
  if (roleAkhir === 'petugas') {
    const layananAkhir = 'layanan_id' in upd ? upd.layanan_id : target.layanan_id;
    if (!layananAkhir) return json({ error: 'layanan_id wajib untuk role petugas' }, 400);
  } else {
    // FAQ umum (keputusan CEO): Front Office/Admin lintas layanan, jadi layanan_id HARUS null (layanan_id terisi pada FO
    // membuka FAQ khusus layanan itu). Klien yang mengirim layanan_id terisi untuk role ini ditolak; bila tidak mengirim,
    // nilai lama (mis. saat petugas dinaikkan jadi FO, atau sisa data lama) dikosongkan otomatis.
    if (b.layanan_id) return json({ error: 'layanan_id harus kosong untuk role Front Office/Admin' }, 400);
    if (target.layanan_id !== null || 'layanan_id' in upd) upd.layanan_id = null;
  }
  if (b.email_notifikasi !== undefined) {
    const e = b.email_notifikasi?.toLowerCase() ?? null;
    if (e !== target.email_notifikasi) {
      upd.email_notifikasi = e;
      upd.email_notifikasi_verified_at = null;
    }
  }
  let usernameBaru: string | null = null;
  if (b.username !== undefined) {
    const u = normalizeUsername(b.username);
    if (!isValidUsername(u)) return json({ error: 'Username tidak valid (huruf kecil/angka/-, 3-32 karakter)' }, 400);
    if (u !== target.username) { usernameBaru = u; upd.username = u; }
  }
  if (b.email_login !== undefined) {
    if (usernameBaru) return json({ error: 'Ubah username ATAU email_login, tidak keduanya' }, 400);
    if (isSyntheticEmail(b.email_login)) return json({ error: 'Gunakan username untuk email login sintetis' }, 400);
  }

  // Fase 3 (review keamanan): penanda Koordinator memberi lingkup data UNIT. Pencabutan dilakukan DB secara atomik
  // (pemicu trg_petugas_cabut_koordinator, migrasi 202610290001) dalam UPDATE yang sama dengan perubahan role/layanan_id.
  // Di sini hanya dibaca keadaan SEBELUM tulis untuk audit (koordinator_dicabut). Kolom belum ada (migrasi belum
  // diterapkan) = tidak ada penanda; galat baca lain = tolak SEBELUM menulis apa pun (tidak dilewati diam-diam).
  const unitBerubah = 'role' in upd || ('layanan_id' in upd && upd.layanan_id !== target.layanan_id);
  let koordinatorDicabut = false;
  if (unitBerubah) {
    const { data: penanda, error: ePenanda } = await service.from('petugas').select('koordinator').eq('id', id).maybeSingle();
    if (ePenanda && !objekBelumAda(ePenanda)) {
      console.error('[admin/petugas PATCH] gagal membaca penanda Koordinator', ePenanda.message);
      return json({ error: 'Gagal membaca penanda Koordinator; tidak ada perubahan yang disimpan' }, 500);
    }
    koordinatorDicabut = !ePenanda && (penanda as { koordinator?: unknown } | null)?.koordinator === true;
  }

  // ---- tulis petugas ----
  if (Object.keys(upd).length > 0) {
    try {
      await mutasiWajibBaris(service.from('petugas').update(upd).eq('id', id).select('id'));
    } catch (e) {
      if (!(e instanceof MutasiError)) throw e;
      // 0 baris = akun hilang sejak dibaca di atas (service-role melewati RLS, jadi bukan penolakan RLS).
      if (e.kode === 'tidak_ada_baris') return json({ error: 'Akun tidak ditemukan' }, 404);
      const code = kodeDbMutasi(e);
      if (code === '23505') return json({ error: 'Username sudah dipakai' }, 409);
      if (code === '23514') return json({ error: 'Data tidak memenuhi aturan format' }, 400);
      const pesanDb = pesanDbMutasi(e);
      // Pesan aturan trigger (bukan galat teknis) memang ditujukan ke Admin.
      if (/Admin aktif terakhir/i.test(pesanDb)) return json({ error: pesanDb }, 409);
      catatMutasiGagal('/api/admin/petugas/[id]', 'admin.petugas.ubah', e, { petugasId: id });
      return json({ error: 'Gagal menyimpan perubahan' }, 500);
    }
  }

  // ---- sinkron email login di Supabase Auth ----
  let sesiGagal = false;
  const emailAuthBaru = usernameBaru ? usernameToEmail(usernameBaru) : b.email_login?.toLowerCase();
  if (emailAuthBaru && target.auth_user_id) {
    const { error: authErr } = await service.auth.admin.updateUserById(target.auth_user_id, {
      email: emailAuthBaru,
      email_confirm: true,
    });
    if (authErr) {
      // Kompensasi: kembalikan username di DB agar sinkron dengan email login Auth (yang tidak berubah).
      // Bila kompensasi gagal, DB dan Auth TIDAK sinkron: dicatat sebagai error dan Admin diperingatkan.
      let kompensasiGagal = false;
      if (usernameBaru) {
        try {
          await mutasiWajibBaris(service.from('petugas').update({ username: target.username }).eq('id', id).select('id'));
        } catch (e) {
          if (!(e instanceof MutasiError)) throw e;
          kompensasiGagal = true;
          catatMutasiGagal('/api/admin/petugas/[id]', 'admin.petugas.ubah.kompensasi_username', e, { petugasId: id });
        }
      }
      const dupe = /already|exists|registered/i.test(authErr.message);
      console.error('[admin/petugas PATCH] sinkron email login gagal', authErr.message);
      const dasar = dupe ? 'Email login sudah dipakai akun lain' : 'Gagal menyinkronkan email login';
      const pesan = kompensasiGagal
        ? `${dasar}. Username belum berhasil dikembalikan ke semula; periksa akun ini sebelum mencoba lagi.`
        : dasar;
      return json({ error: pesan }, dupe ? 409 : 502);
    }
    if (!self) {
      // Keamanan: identitas login berubah -> sesi lama target harus diakhiri. Gagal = sesi lama bisa tetap hidup.
      try {
        await mutasiInsert(service.rpc('akun_akhiri_sesi', { p_auth_user_id: target.auth_user_id }));
      } catch (e) {
        if (!(e instanceof MutasiError)) throw e;
        sesiGagal = true;
        catatMutasiGagal('/api/admin/petugas/[id]', 'admin.petugas.ubah.akhiri_sesi', e, { petugasId: id });
      }
    }
  }

  await audit(service, actor, 'akun_ubah', id, {
    kolom: Object.keys(upd).filter((k) => k !== 'email_notifikasi_verified_at'),
    role: 'role' in upd ? { dari: target.role, ke: upd.role } : undefined,
    username: usernameBaru ? { dari: target.username, ke: usernameBaru } : undefined,
    email_login_diganti: emailAuthBaru ? true : undefined,
    sesi_diakhiri: emailAuthBaru && !self ? !sesiGagal : undefined,
    koordinator_dicabut: koordinatorDicabut || undefined,
  });
  // Perubahan sudah tersimpan; kegagalan mengakhiri sesi dikabarkan lewat `peringatan` (pola yang sama dengan /status).
  return json({
    ok: true,
    ...(sesiGagal ? { peringatan: 'Perubahan tersimpan, tetapi sesi lama akun ini gagal diakhiri. Minta pengguna keluar, atau atur ulang sandinya.' } : {}),
  });
}
