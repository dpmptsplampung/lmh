// Pembantu route akun (server-only): service client, penjaga Admin/staf, rate limit, audit, token, email.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import crypto from 'node:crypto';

export function getServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export type Actor = { id: string; role: string; aktif: boolean; auth_user_id: string };

/** Admin AKTIF saja. 401 = belum login/nonaktif, 403 = bukan Admin. */
export async function requireAdmin(): Promise<{ actor: Actor; service: SupabaseClient } | { res: NextResponse }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { res: json({ error: 'Unauthorized' }, 401) };
  const { data: p } = await supabase
    .from('petugas')
    .select('id, role, aktif')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!p || p.aktif !== true) return { res: json({ error: 'Unauthorized' }, 401) };
  if (p.role !== 'admin') return { res: json({ error: 'Hanya Admin' }, 403) };
  const service = getServiceClient();
  if (!service) return { res: json({ error: 'Server misconfigured' }, 500) };
  return { actor: { ...p, auth_user_id: user.id } as Actor, service };
}

export type Staf = {
  id: string; nama: string; username: string | null; role: string; layanan_id: string | null; no_hp: string | null;
  email_notifikasi: string | null; email_notifikasi_verified_at: string | null; operator_default: string | null;
  wajib_ganti_sandi: boolean; aktif: boolean; layanan: { nama: string } | { nama: string }[] | null;
};

/** Staf AKTIF mana pun (profil sendiri). */
export async function requireStaf(): Promise<
  { supabase: Awaited<ReturnType<typeof createClient>>; user: { id: string; email?: string }; me: Staf } | { res: NextResponse }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { res: json({ error: 'Unauthorized' }, 401) };
  const { data: me } = await supabase
    .from('petugas')
    .select('id, nama, username, role, layanan_id, no_hp, email_notifikasi, email_notifikasi_verified_at, operator_default, wajib_ganti_sandi, aktif, layanan(nama)')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!me || me.aktif !== true) return { res: json({ error: 'Unauthorized' }, 401) };
  return { supabase, user, me: me as unknown as Staf };
}

/** Rate limit via anon_rate_limit (pola umkm/request-edit-link). Gagal-tutup. true = masih ada jatah (dan dicatat). */
export async function ambilJatah(service: SupabaseClient, key: string, max: number, windowSec: number): Promise<boolean> {
  const since = new Date(Date.now() - windowSec * 1000).toISOString();
  const { count, error } = await service
    .from('anon_rate_limit')
    .select('*', { count: 'exact', head: true })
    .eq('action', key)
    .gte('created_at', since)
    .is('user_id', null);
  if (error || (count ?? 0) >= max) return false;
  await service.from('anon_rate_limit').insert({ user_id: null, action: key });
  return true;
}

export const hashKey = (s: string) => crypto.createHash('sha256').update(s.trim().toLowerCase()).digest('hex').slice(0, 16);
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const newToken = () => crypto.randomBytes(32).toString('base64url');

/** Sandi sementara 14 karakter, tanpa karakter ambigu. */
export function generateTempPassword(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from({ length: 14 }, () => abc[crypto.randomInt(abc.length)]).join('');
}

export function clientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
}

export const publicBaseUrl = (): string | null => process.env.NEXT_PUBLIC_PUBLIC_URL?.replace(/\/$/, '') || null;

export async function audit(
  service: SupabaseClient,
  actor: { id: string; role: string },
  aksi: string,
  entitasId: string,
  detail: Record<string, unknown>,
) {
  // Detail TIDAK boleh memuat sandi/token. Kegagalan audit tidak menggagalkan aksi (dicatat di log).
  const { error } = await service.from('audit_log').insert({
    actor_id: actor.id, actor_role: actor.role, aksi, entitas: 'petugas', entitas_id: entitasId, detail,
  });
  if (error) console.error('[akun] gagal menulis audit_log', aksi, error.message);
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Kirim email via Resend. false = Resend belum dikonfigurasi atau gagal kirim. */
export async function kirimEmail(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const from = process.env.RESEND_FROM || 'DPMPTSP Lampung <noreply@lmh.lampungprov.go.id>';
  const { error } = await new Resend(apiKey).emails.send({ from, to, subject, html });
  if (error) console.error('[akun] gagal kirim email', error);
  return !error;
}

/** Buat token verifikasi email notifikasi (berlaku 30 menit, sekali pakai) lalu kirim tautan. */
export async function kirimVerifikasiEmail(service: SupabaseClient, petugasId: string, email: string): Promise<boolean> {
  const base = publicBaseUrl();
  if (!base) return false;
  if (!(await ambilJatah(service, `akun_verif:${petugasId}`, 3, 3600))) return false;
  const token = newToken();
  const { error } = await service.from('petugas_verif_email').upsert({
    petugas_id: petugasId,
    email,
    token_hash: sha256(token),
    kedaluwarsa: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    dibuat_at: new Date().toISOString(),
  });
  if (error) return false;
  const link = `${base}/api/auth/verifikasi-email?token=${encodeURIComponent(token)}`;
  return kirimEmail(
    email,
    'Verifikasi email notifikasi — DPMPTSP Lampung',
    `<p>Klik tautan berikut untuk memverifikasi email notifikasi akun Layanan Maju Hub Anda (berlaku 30 menit):</p>
     <p><a href="${esc(link)}">Verifikasi email</a></p>
     <p>Abaikan email ini bila Anda tidak merasa memintanya.</p>`,
  );
}
