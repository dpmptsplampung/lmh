// Login USERNAME (RBAC Tahap 2, docs/RBAC_USULAN_BAGIAN2_DRAFT.md C, opsi 1b): username dipetakan
// deterministik ke email login sintetis `{username}@{domain}`. Dipakai browser (form /login) DAN server.
// Supabase tidak pernah dipakai mengirim email ke alamat sintetis (tanpa recover/invite/magiclink
// Supabase; pemulihan lewat Resend ke email_notifikasi). Murni, tanpa import server-only.

/** Domain email login sintetis. Ganti via env bila GoTrue menolak `.internal` (mis. validasi MX). */
export const STAFF_EMAIL_DOMAIN = process.env.NEXT_PUBLIC_STAFF_LOGIN_DOMAIN || 'staf.lmh.internal';

export const USERNAME_RE = /^[a-z0-9][a-z0-9-]{2,31}$/;
export const USERNAME_TERLARANG = ['admin', 'root', 'support', 'system', 'api', 'null', 'undefined'];

/** Pesan galat seragam: tidak membedakan "username tidak ada" dan "sandi salah". */
export const PESAN_LOGIN_GAGAL = 'Nama pengguna atau kata sandi salah';

export const normalizeUsername = (s: string): string => s.trim().toLowerCase();

export function isValidUsername(u: string): boolean {
  return USERNAME_RE.test(u) && !USERNAME_TERLARANG.includes(u);
}

export const usernameToEmail = (u: string): string => `${normalizeUsername(u)}@${STAFF_EMAIL_DOMAIN}`;

export function isSyntheticEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${STAFF_EMAIL_DOMAIN}`);
}

/**
 * Masukan kotak login -> email untuk signInWithPassword.
 * Mengandung '@' = dipakai apa adanya (masa transisi akun lama / pengunjung), selain itu = username.
 */
export function resolveLoginEmail(input: string): string {
  const v = input.trim();
  return v.includes('@') ? v.toLowerCase() : usernameToEmail(v);
}

/** Normalisasi nomor HP Indonesia -> `+62...`; null bila tidak valid. */
export function normalizeNoHp(raw: string): string | null {
  const s = raw.replace(/[\s().-]/g, '');
  const e164 = s.startsWith('+') ? s : s.startsWith('0') ? `+62${s.slice(1)}` : s.startsWith('62') ? `+${s}` : '';
  return /^\+[0-9]{8,15}$/.test(e164) ? e164 : null;
}
