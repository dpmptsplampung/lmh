import { NextResponse } from 'next/server';
import { punyaIdentitasGoogle, type PenggunaAuth } from './identitas-google';

export { punyaIdentitasGoogle, type PenggunaAuth };

// Keputusan pemilik: live chat WAJIB login Google untuk PENGUNJUNG. Akun anonim ditolak untuk semua; pengunjung nonanonim
// tanpa identitas Google (mis. akun sandi) juga ditolak. STAF sah (petugas aktif, ditentukan pemanggil dari tabel `petugas`)
// tetap boleh memakai chat dengan sandi. Bukti Google HANYA dari data Auth tepercaya (`identities`, `app_metadata`);
// `user_metadata` dan profil `pengunjung.provider` dapat diubah klien dan tidak dipercaya.
// Aturan SQL padanannya (R1, lapis data): pengunjung = nonanonim + auth.identities.provider='google'; staf = get_my_role().
export const PESAN_LOGIN_GOOGLE = 'Live chat hanya untuk pengunjung yang masuk dengan akun Google. Silakan masuk dengan Google terlebih dahulu.';

function tolakLoginGoogle(): NextResponse {
  return NextResponse.json({ error: PESAN_LOGIN_GOOGLE, kode: 'LOGIN_GOOGLE' }, { status: 403 });
}

/** Respons 403 bila `user` adalah akun anonim; `null` bila boleh lanjut. Gerbang awal murah (tanpa query). */
export function tolakAkunAnonim(user: PenggunaAuth | null | undefined): NextResponse | null {
  return user?.is_anonymous === true ? tolakLoginGoogle() : null;
}

/**
 * Gerbang penuh: anonim selalu ditolak; non-staf wajib identitas Google. `adalahStaf` diisi pemanggil dari
 * `resolveActor` (petugas aktif), bukan dari klaim klien.
 */
export function tolakBukanGoogle(user: PenggunaAuth | null | undefined, adalahStaf: boolean): NextResponse | null {
  if (user?.is_anonymous === true) return tolakLoginGoogle();
  if (adalahStaf) return null;
  return punyaIdentitasGoogle(user) ? null : tolakLoginGoogle();
}
