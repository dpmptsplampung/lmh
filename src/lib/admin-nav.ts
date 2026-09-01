// Sumber kebenaran tunggal untuk akses halaman admin per role.
// Dipakai oleh Sidebar (filter menu) dan AdminGuard (route guard) agar
// keduanya tidak pernah berbeda pendapat.

export type AdminRole = 'admin' | 'petugas' | 'front_office';

export interface AdminNavEntry {
  label: string;
  href: string;
  iconKey:
    | 'dashboard' | 'kunjungan' | 'scan' | 'antrian' | 'absensi' | 'chat'
    | 'faq' | 'umkm' | 'gallery' | 'leads' | 'skm' | 'aiLog' | 'governance'
    | 'petugas' | 'jadwal' | 'settings' | 'landing' | 'public' | 'pengaduan' | 'layar'
    | 'rekap' | 'dokumen';
  roles: AdminRole[];
}

export const ADMIN_NAV: AdminNavEntry[] = [
  { label: 'Dashboard', href: '/admin', iconKey: 'dashboard', roles: ['admin'] },
  { label: 'Kunjungan', href: '/admin/kunjungan', iconKey: 'kunjungan', roles: ['admin', 'front_office'] },
  { label: 'Scan QR', href: '/admin/scan', iconKey: 'scan', roles: ['admin', 'front_office'] },
  { label: 'Antrian', href: '/admin/antrian', iconKey: 'antrian', roles: ['admin', 'petugas', 'front_office'] },
  { label: 'Absensi', href: '/admin/absensi', iconKey: 'absensi', roles: ['admin', 'petugas', 'front_office'] },
  { label: 'Live Chat', href: '/admin/chat', iconKey: 'chat', roles: ['admin', 'petugas', 'front_office'] },
  { label: 'Kelola FAQ', href: '/admin/chat/faq', iconKey: 'faq', roles: ['admin', 'petugas'] },
  { label: 'UMKM', href: '/admin/umkm', iconKey: 'umkm', roles: ['admin'] },
  { label: 'Investment Gallery', href: '/admin/gallery', iconKey: 'gallery', roles: ['admin'] },
  { label: 'Lead Investasi', href: '/admin/investasi-leads', iconKey: 'leads', roles: ['admin'] },
  { label: 'Hasil SKM', href: '/admin/skm', iconKey: 'skm', roles: ['admin', 'petugas', 'front_office'] },
  { label: 'Pengaduan', href: '/admin/pengaduan', iconKey: 'pengaduan', roles: ['admin', 'petugas', 'front_office'] },
  { label: 'Log AI Chat', href: '/admin/chat/ai-log', iconKey: 'aiLog', roles: ['admin'] },
  { label: 'Tata Kelola Data', href: '/admin/data-governance', iconKey: 'governance', roles: ['admin'] },
  { label: 'Kelola Petugas', href: '/admin/petugas', iconKey: 'petugas', roles: ['admin'] },
  { label: 'Jadwal Layanan', href: '/admin/settings/jadwal', iconKey: 'jadwal', roles: ['admin', 'petugas', 'front_office'] },
  { label: 'Pengaturan', href: '/admin/settings', iconKey: 'settings', roles: ['admin'] },
  { label: 'Kelola Layar', href: '/admin/layar', iconKey: 'layar', roles: ['admin'] },
  { label: 'Rekap Harian', href: '/admin/rekap', iconKey: 'rekap', roles: ['admin', 'petugas', 'front_office'] },
  { label: 'Dokumen Peraturan', href: '/admin/dokumen', iconKey: 'dokumen', roles: ['admin'] },
  { label: 'Konten Landing', href: '/admin/settings/landing', iconKey: 'landing', roles: ['admin'] },
  { label: 'Tampilan Publik', href: '/', iconKey: 'public', roles: ['admin', 'petugas', 'front_office'] },
];

// Apakah role boleh membuka pathname di area /admin (kecuali '/': publik).
export function canAccessAdminPath(role: AdminRole, pathname: string): boolean {
  // Exact-match terlebih dahulu (sub-path dari entry lain bisa beda role).
  const exact = ADMIN_NAV.find((e) => e.href === pathname);
  if (exact) return exact.roles.includes(role);

  // Prefix match: pilih entry paling spesifik yang menjadi induk pathname.
  const parents = ADMIN_NAV
    .filter((e) => e.href !== '/' && pathname.startsWith(`${e.href}/`))
    .sort((a, b) => b.href.length - a.href.length);
  if (parents.length > 0) return parents[0].roles.includes(role);

  // Halaman /admin yang tidak terdaftar: hanya admin (fail-closed).
  return role === 'admin';
}
