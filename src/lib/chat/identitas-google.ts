// Penilaian identitas pengunjung chat yang murni (aman dipakai di klien dan server; tanpa next/server).
// Bukti Google HANYA dari data Auth tepercaya (`identities`, `app_metadata`); `user_metadata` dan profil
// `pengunjung.provider` dapat diubah klien dan tidak dipercaya.

export type PenggunaAuth = {
  is_anonymous?: boolean;
  identities?: ReadonlyArray<{ provider?: string }> | null;
  app_metadata?: { provider?: unknown; providers?: unknown; role?: unknown } | null;
};

export const PERAN_STAF = ['admin', 'petugas', 'front_office'] as const;

/** True bila akun nonanonim dan Auth mencatat identitas Google. */
export function punyaIdentitasGoogle(user: PenggunaAuth | null | undefined): boolean {
  if (!user || user.is_anonymous === true) return false;
  if (user.identities?.some((i) => i?.provider === 'google')) return true;
  const meta = user.app_metadata;
  if (meta?.provider === 'google') return true;
  return Array.isArray(meta?.providers) && meta.providers.includes('google');
}

/**
 * Penyaring UI (bukan gerbang keamanan): boleh menampilkan chat bila nonanonim dan (Google, atau role staf di JWT).
 * Gerbang sebenarnya ada di route (tabel `petugas`) dan di RLS.
 */
export function layakMemakaiChat(user: PenggunaAuth | null | undefined): boolean {
  if (!user || user.is_anonymous === true) return false;
  if (punyaIdentitasGoogle(user)) return true;
  const role = user.app_metadata?.role;
  return typeof role === 'string' && (PERAN_STAF as readonly string[]).includes(role);
}
