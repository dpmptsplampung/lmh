// Rute per peran staf. Murni (tanpa I/O) agar dipakai proxy, AdminGuard, login, dan callback.
// Daftar menu dan izin halaman ada di admin-nav.ts (sumber tunggal); berkas ini hanya memetakan
// peran ke area (/admin untuk admin dan Front Office, /petugas untuk Petugas Layanan).
import { ADMIN_NAV, dalamArea } from '@/lib/admin-nav';

export const BERANDA_PETUGAS = '/petugas/antrean';
export const PROFIL_ADMIN = '/admin/profil';
export const PROFIL_PETUGAS = '/petugas/profil';

/** Halaman pertama setelah login. Role di luar tiga peran staf = null (pemanggil memakai /me atau tujuan sendiri). */
export function berandaPeran(role: string | null | undefined): string | null {
  if (role === 'petugas') return BERANDA_PETUGAS;
  if (role === 'admin' || role === 'front_office') return '/admin';
  return null;
}

/** Tujuan bila rute ditolak: halaman yang pasti boleh dibuka peran itu (tidak boleh memantul balik). */
export function berandaTolak(role: string | null | undefined): string {
  if (role === 'petugas') return BERANDA_PETUGAS;
  if (role === 'admin' || role === 'front_office') return '/admin/antrian';
  return '/me';
}

/** Halaman Profil Saya (tempat ganti sandi wajib) menurut peran. */
export function halamanProfilPeran(role: string | null | undefined): string {
  return role === 'petugas' ? PROFIL_PETUGAS : PROFIL_ADMIN;
}

/** Awalan area peran: tautan /admin untuk admin/FO dan /petugas untuk petugas. */
export function areaPeran(role: string | null | undefined): '/admin' | '/petugas' {
  return role === 'petugas' ? '/petugas' : '/admin';
}

/**
 * Padanan rute /petugas untuk sebuah alamat /admin lama (tautan notifikasi di DB, bookmark), atau null bila
 * halaman itu tidak ada untuk petugas. Memakai entri ADMIN_NAV paling spesifik; sisa path ikut:
 * /admin/chat/faq -> /petugas/chat/faq, /admin/umkm-tugas -> /petugas/umkm/tugas, /admin/kunjungan -> null.
 */
export function padananPetugas(pathname: string): string | null {
  if (!dalamArea(pathname, '/admin')) return null;
  const exact = ADMIN_NAV.find((e) => e.href === pathname);
  const induk =
    exact ??
    ADMIN_NAV
      .filter((e) => e.href !== '/' && e.href !== '/admin' && pathname.startsWith(`${e.href}/`))
      .sort((a, b) => b.href.length - a.href.length)[0];
  if (!induk || !induk.hrefPetugas || !(induk.roles as string[]).includes('petugas')) return null;
  return `${induk.hrefPetugas}${pathname.slice(induk.href.length)}`;
}

/**
 * Pengalihan antar-area bila peran membuka area yang bukan miliknya (tanpa query; pemanggil menambahkan):
 * - petugas di /admin/*  -> padanannya di /petugas, atau Antrean petugas bila tidak ada;
 * - admin/front_office di /petugas/* -> /admin.
 * null = sudah di area yang benar.
 */
export function alihkanAreaPeran(role: string | null | undefined, pathname: string): string | null {
  if (role === 'petugas' && dalamArea(pathname, '/admin')) return padananPetugas(pathname) ?? BERANDA_PETUGAS;
  if ((role === 'admin' || role === 'front_office') && dalamArea(pathname, '/petugas')) return '/admin';
  return null;
}
