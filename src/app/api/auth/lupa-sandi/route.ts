import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { ambilJatah, clientIp, esc, getServiceClient, hashKey, json, kirimEmail, publicBaseUrl } from '@/lib/akun/server';
import { normalizeUsername } from '@/lib/akun/login';

export const dynamic = 'force-dynamic';

const schema = z.object({ username: z.string().trim().min(1).max(64) });
const OK = { ok: true, pesan: 'Bila akun terdaftar dan email notifikasi sudah terverifikasi, tautan pengaturan sandi dikirim.' };

// Lupa sandi mandiri: SELALU jawaban sama (anti-enumerasi). Tautan recovery dibuat server (tidak dikirim
// Supabase) lalu dikirim via Resend ke email_notifikasi TERVERIFIKASI; email sintetis tak pernah dikirimi surat.
export async function POST(request: NextRequest) {
  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return json({ error: 'Invalid input' }, 400);
  const username = normalizeUsername(parsed.data.username);

  const service = getServiceClient();
  const base = publicBaseUrl();
  if (!service || !base || !process.env.RESEND_API_KEY) return json({ error: 'Layanan email belum dikonfigurasi' }, 503);

  // Jatah dihitung SEBELUM mencari akun: respons 429 tidak bergantung pada keberadaan akun.
  const okUser = await ambilJatah(service, `lupa_sandi_u:${hashKey(username)}`, 3, 900);
  const okIp = await ambilJatah(service, `lupa_sandi_ip:${hashKey(clientIp(request))}`, 10, 900);
  if (!okUser || !okIp) return json({ error: 'Terlalu banyak permintaan. Coba lagi dalam beberapa menit.' }, 429);

  const { data: p } = await service
    .from('petugas')
    .select('auth_user_id, nama, aktif, email_notifikasi, email_notifikasi_verified_at')
    .eq('username', username)
    .maybeSingle();
  if (!p || !p.aktif || !p.email_notifikasi || !p.email_notifikasi_verified_at || !p.auth_user_id) return json(OK);

  const { data: u } = await service.auth.admin.getUserById(p.auth_user_id);
  const loginEmail = u?.user?.email;
  if (!loginEmail) return json(OK);

  const { data: link, error } = await service.auth.admin.generateLink({
    type: 'recovery',
    email: loginEmail,
    options: { redirectTo: `${base}/auth/callback?next=${encodeURIComponent('/admin/profil?wajib=1')}` },
  });
  const action = link?.properties?.action_link;
  if (error || !action) {
    console.error('[auth/lupa-sandi] generateLink gagal', error?.message);
    return json(OK);
  }
  await kirimEmail(
    p.email_notifikasi,
    'Atur ulang kata sandi — DPMPTSP Lampung',
    `<p>Halo ${esc(p.nama)}, ada permintaan mengatur ulang kata sandi akun <b>${esc(username)}</b>.</p>
     <p><a href="${esc(action)}">Klik di sini untuk mengatur kata sandi baru</a></p>
     <p>Abaikan email ini bila Anda tidak memintanya.</p>`,
  );
  return json(OK);
}
