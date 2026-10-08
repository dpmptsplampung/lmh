import { getServiceClient, json, kirimVerifikasiEmail, publicBaseUrl, requireStaf } from '@/lib/akun/server';

export const dynamic = 'force-dynamic';

// Kirim ulang tautan verifikasi email notifikasi (maks 3/jam, dijaga di kirimVerifikasiEmail).
export async function POST() {
  const g = await requireStaf();
  if ('res' in g) return g.res;
  const { me } = g;
  if (!me.email_notifikasi) return json({ error: 'Belum ada email notifikasi' }, 400);
  if (me.email_notifikasi_verified_at) return json({ error: 'Email sudah terverifikasi' }, 400);
  const service = getServiceClient();
  if (!service || !publicBaseUrl() || !process.env.RESEND_API_KEY) {
    return json({ error: 'Layanan email belum dikonfigurasi' }, 503);
  }
  const ok = await kirimVerifikasiEmail(service, me.id, me.email_notifikasi);
  return ok ? json({ ok: true }) : json({ error: 'Terlalu banyak permintaan atau pengiriman gagal. Coba lagi nanti.' }, 429);
}
