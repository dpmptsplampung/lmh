// Sumber menu cangkang pengunjung (/me/*). Terpisah dari admin-nav.ts agar AdminGuard dan akses staf tidak tersentuh.

export type PengunjungIconKey = 'beranda' | 'reservasi' | 'notifikasi' | 'chat' | 'situs';

export interface PengunjungNavEntry {
  label: string;
  href: string;
  iconKey: PengunjungIconKey;
  /** Letak: menu utama atau tautan bawah (di atas tombol Keluar). */
  slot?: 'utama' | 'bawah';
  /** Lencana jumlah (hanya Notifikasi yang belum dilihat). */
  badgeKey?: 'notifikasi';
}

export const PENGUNJUNG_NAV: readonly PengunjungNavEntry[] = [
  { label: 'Beranda saya', href: '/me', iconKey: 'beranda' },
  { label: 'Reservasi', href: '/me/reservasi', iconKey: 'reservasi' },
  { label: 'Notifikasi', href: '/me/notifications', iconKey: 'notifikasi', badgeKey: 'notifikasi' },
  { label: 'Chat', href: '/chat', iconKey: 'chat' },
  { label: 'Situs utama', href: '/', iconKey: 'situs', slot: 'bawah' },
];

/** Awalan kunci; nilai lama tanpa identitas akun tidak dipakai karena pemiliknya tidak diketahui. */
export const KUNCI_NOTIFIKASI_DILIHAT = 'lmh.pengunjung.notifikasiDilihat';

/** Waktu terakhir Notifikasi dibuka (ISO) milik satu akun, bukan seluruh browser. */
export function kunciNotifikasiDilihat(userId: string): string {
  return `${KUNCI_NOTIFIKASI_DILIHAT}:${userId}`;
}

/**
 * Entri aktif untuk sebuah path: kecocokan persis, lalu awalan terpanjang pada batas segmen.
 * "/me" hanya cocok persis (kalau tidak, ia menelan /me/reservasi). "/" tidak pernah aktif.
 */
export function cariEntriPengunjungAktif(pathname: string | null | undefined): PengunjungNavEntry | undefined {
  if (!pathname) return undefined;
  const bersih = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  let terbaik: PengunjungNavEntry | undefined;
  for (const e of PENGUNJUNG_NAV) {
    if (e.href === '/') continue;
    const cocok = bersih === e.href || (e.href !== '/me' && bersih.startsWith(`${e.href}/`));
    if (cocok && (!terbaik || e.href.length > terbaik.href.length)) terbaik = e;
  }
  return terbaik;
}
