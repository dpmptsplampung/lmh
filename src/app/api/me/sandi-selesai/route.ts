import { audit, getServiceClient, json, requireStaf } from '@/lib/akun/server';

export const dynamic = 'force-dynamic';

const BATAS_MENIT = 10;

// Dipanggil browser SETELAH supabase.auth.updateUser({ password }) berhasil pada sesi pemulihan
// (lupa sandi) -- jalur itu tidak melewati /api/me/sandi, jadi flag wajib_ganti_sandi dibersihkan di sini.
// Penjaga (flag ini bukan batas keamanan, tapi jangan jadi tombol "lewati"):
//   - sesi login-dengan-sandi ditolak (ganti sandi lewat /api/me/sandi yang menuntut sandi lama);
//   - akun auth harus baru saja diperbarui (<= 10 menit), yaitu sandi memang baru diganti.
export async function POST() {
  const g = await requireStaf();
  if ('res' in g) return g.res;
  const { supabase, me } = g;

  if (!me.wajib_ganti_sandi) return json({ ok: true, sudah_bersih: true });

  const { data: claims } = await supabase.auth.getClaims();
  const amr = (claims?.claims?.amr ?? []) as Array<{ method?: string }>;
  if (amr[0]?.method === 'password') {
    return json({ error: 'Gunakan penggantian sandi dengan sandi lama' }, 403);
  }
  const { data: { user } } = await supabase.auth.getUser();
  const diperbarui = user?.updated_at ? new Date(user.updated_at).getTime() : 0;
  if (Date.now() - diperbarui > BATAS_MENIT * 60_000) {
    return json({ error: 'Sandi belum diganti. Ganti sandi dahulu.' }, 409);
  }

  const service = getServiceClient();
  if (!service) return json({ error: 'Server misconfigured' }, 500);
  const { error } = await service.from('petugas').update({ wajib_ganti_sandi: false }).eq('id', me.id);
  if (error) {
    console.error('[me/sandi-selesai] gagal', error.message);
    return json({ error: 'Gagal memperbarui status' }, 500);
  }
  await audit(service, { id: me.id, role: me.role }, 'akun_ganti_sandi_pemulihan', me.id, {});
  return json({ ok: true });
}
