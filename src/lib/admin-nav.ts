// Sumber kebenaran tunggal untuk akses halaman admin per role.
// Dipakai oleh Sidebar (filter menu) dan AdminGuard (route guard) agar
// keduanya tidak pernah berbeda pendapat.

export type AdminRole = 'admin' | 'petugas' | 'front_office';

export type AdminNavGroupKey =
  | 'frontOffice' | 'antrean' | 'layananOnline' | 'laporan'
  | 'pengelolaan' | 'kemitraan' | 'konten' | 'sistem';

export interface AdminNavGroup {
  key: AdminNavGroupKey;
  label: string;
  iconKey: AdminNavGroupKey;
}

// Kelompok menu sidebar. URUTAN ARRAY = urutan tampil (atas -> bawah), disusun dari
// yang paling sering dipakai dalam operasional pelayanan harian sampai yang paling jarang.
// Hanya presentasi: akses per role tetap ditentukan `roles` di tiap entri (bukan grup).
export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  { key: 'frontOffice', label: 'Front Office', iconKey: 'frontOffice' },
  { key: 'antrean', label: 'Antrean & Kehadiran', iconKey: 'antrean' },
  { key: 'layananOnline', label: 'Layanan Online', iconKey: 'layananOnline' },
  { key: 'laporan', label: 'Laporan & Evaluasi', iconKey: 'laporan' },
  { key: 'pengelolaan', label: 'Pengelolaan Layanan', iconKey: 'pengelolaan' },
  { key: 'kemitraan', label: 'Kemitraan & Investasi', iconKey: 'kemitraan' },
  { key: 'konten', label: 'Konten & Dokumen', iconKey: 'konten' },
  { key: 'sistem', label: 'Sistem & Keamanan', iconKey: 'sistem' },
];

// Badge notifikasi pada menu (jumlah data yang perlu dibuka). Sumber hitungan: lib/hooks/useNavBadges.ts.
export type AdminBadgeKey = 'kotakMasukFo' | 'liveChat' | 'penangananFo' | 'antrian' | 'pengaduan';

// Role yang berhak melihat tiap badge (juga menentukan kueri hitungan yang dijalankan).
// Sengaja eksplisit: tidak semua yang boleh MEMBUKA halaman perlu diberi badge (mis. petugas layanan
// hanya melihat pengaduan, tidak bisa menindaklanjuti, jadi tanpa badge pengaduan).
export const ADMIN_BADGE_ROLES: Record<AdminBadgeKey, AdminRole[]> = {
  kotakMasukFo: ['admin', 'front_office'],
  liveChat: ['admin', 'petugas', 'front_office'],
  penangananFo: ['admin', 'front_office'],
  antrian: ['admin', 'petugas', 'front_office'],
  pengaduan: ['admin', 'front_office'],
};

export function badgeKeysForRole(role: string | null | undefined): AdminBadgeKey[] {
  if (!role) return [];
  return (Object.keys(ADMIN_BADGE_ROLES) as AdminBadgeKey[]).filter((k) =>
    (ADMIN_BADGE_ROLES[k] as string[]).includes(role),
  );
}

export interface AdminNavEntry {
  label: string;
  href: string;
  iconKey:
    | 'dashboard' | 'kunjungan' | 'scan' | 'antrian' | 'absensi' | 'chat'
    | 'faq' | 'umkm' | 'gallery' | 'leads' | 'skm' | 'aiLog' | 'governance'
    | 'petugas' | 'jadwal' | 'settings' | 'landing' | 'public' | 'pengaduan' | 'layar'
    | 'rekap' | 'dokumen' | 'profil' | 'kelolaLayanan' | 'bukuTamu' | 'riwayat' | 'ai'
    | 'kotakMasuk' | 'penanganan' | 'daftarFo' | 'topik' | 'rekapFo' | 'performa';
  roles: AdminRole[];
  // Kelompok menu (dropdown). Tanpa `group` = tautan tunggal di luar kelompok.
  group?: AdminNavGroupKey;
  // Badge notifikasi yang ditampilkan pada menu ini (peta href -> badge, satu badge per entri).
  badgeKey?: AdminBadgeKey;
  // Entri tersembunyi: tetap dipakai canAccessAdminPath dan findGroupForPath (mis. halaman lama yang kini
  // redirect ke halaman gabungan, agar tidak terblokir AdminGuard) tetapi tidak tampil di sidebar/badge/pohon.
  hidden?: boolean;
  // Untuk entri tersembunyi: href entri sidebar yang ditandai aktif saat halaman ini dibuka.
  tampilSebagai?: string;
  // Hanya untuk tautan tunggal: di atas semua kelompok (default) atau di bawahnya.
  slot?: 'atas' | 'bawah';
}

// URUTAN ARRAY = urutan tampil di sidebar: tautan 'atas', lalu kelompok menurut
// ADMIN_NAV_GROUPS (anak tiap kelompok mengikuti urutan array ini), lalu tautan 'bawah'.
// Urutan = prioritas pemakaian harian operasional pelayanan (paling penting di atas).
// Penyaringan per role tidak mengubah urutan relatif.
export const ADMIN_NAV: AdminNavEntry[] = [
  { label: 'Dashboard', href: '/admin', iconKey: 'dashboard', roles: ['admin', 'front_office'] },

  // Front Office. Alur Front Office (Tahap B): FO melayani dulu, mengeskalasi ke petugas layanan bila perlu.
  // Halaman /admin/fo/* hanya untuk FO dan Admin (Admin sebagai pengganti FO, kontrak RPC §8).
  { label: 'Registrasi Pengunjung', href: '/admin/fo/registrasi', iconKey: 'daftarFo', roles: ['admin', 'front_office'], group: 'frontOffice' },
  { label: 'Kotak Masuk FO', href: '/admin/fo/kotak-masuk', iconKey: 'kotakMasuk', roles: ['admin', 'front_office'], group: 'frontOffice', badgeKey: 'kotakMasukFo' },
  { label: 'Penanganan', href: '/admin/fo/penanganan', iconKey: 'penanganan', roles: ['admin', 'front_office'], group: 'frontOffice', badgeKey: 'penangananFo' },
  // Halaman lama (kini redirect ke /admin/fo/registrasi?tab=walkin|scan): tersembunyi di sidebar tetapi tetap lolos
  // canAccessAdminPath untuk admin dan front_office (rute tak terdaftar = admin-only akan memblokir FO sebelum redirect).
  { label: 'Daftar FO', href: '/admin/fo/daftar', iconKey: 'daftarFo', roles: ['admin', 'front_office'], group: 'frontOffice', hidden: true, tampilSebagai: '/admin/fo/registrasi' },
  { label: 'Scan QR', href: '/admin/scan', iconKey: 'scan', roles: ['admin', 'front_office'], group: 'frontOffice', hidden: true, tampilSebagai: '/admin/fo/registrasi' },

  // Antrean & Kehadiran
  { label: 'Antrian', href: '/admin/antrian', iconKey: 'antrian', roles: ['admin', 'petugas', 'front_office'], group: 'antrean', badgeKey: 'antrian' },
  { label: 'Absensi', href: '/admin/absensi', iconKey: 'absensi', roles: ['admin', 'petugas', 'front_office'], group: 'antrean' },
  { label: 'Kunjungan', href: '/admin/kunjungan', iconKey: 'kunjungan', roles: ['admin', 'front_office'], group: 'antrean' },
  { label: 'Buku Tamu', href: '/admin/buku-tamu', iconKey: 'bukuTamu', roles: ['admin', 'front_office'], group: 'antrean' },

  // Layanan Online
  { label: 'Live Chat', href: '/admin/chat', iconKey: 'chat', roles: ['admin', 'petugas', 'front_office'], group: 'layananOnline', badgeKey: 'liveChat' },
  { label: 'Pengaduan', href: '/admin/pengaduan', iconKey: 'pengaduan', roles: ['admin', 'petugas', 'front_office'], group: 'layananOnline', badgeKey: 'pengaduan' },
  // Front Office hanya mengelola FAQ umum (layanan_id NULL; RLS faq_fo_umum, lihat src/lib/faq-scope.ts).
  { label: 'Kelola FAQ', href: '/admin/chat/faq', iconKey: 'faq', roles: ['admin', 'petugas', 'front_office'], group: 'layananOnline' },
  { label: 'Log AI Chat', href: '/admin/chat/ai-log', iconKey: 'aiLog', roles: ['admin'], group: 'layananOnline' },

  // Laporan & Evaluasi. Tahap D: rekap harian FO (Admin dan semua FO melihat semua FO, keputusan CEO 2026-10-14) dan performa (Admin).
  { label: 'Rekap Harian', href: '/admin/rekap', iconKey: 'rekap', roles: ['admin', 'petugas', 'front_office'], group: 'laporan' },
  { label: 'Rekap Front Office', href: '/admin/rekap-fo', iconKey: 'rekapFo', roles: ['admin', 'front_office'], group: 'laporan' },
  { label: 'Hasil SKM', href: '/admin/skm', iconKey: 'skm', roles: ['admin', 'petugas', 'front_office'], group: 'laporan' },
  { label: 'Performa Pelayanan', href: '/admin/performa', iconKey: 'performa', roles: ['admin'], group: 'laporan' },

  // Pengelolaan Layanan
  { label: 'Jadwal Layanan', href: '/admin/settings/jadwal', iconKey: 'jadwal', roles: ['admin', 'petugas', 'front_office'], group: 'pengelolaan' },
  { label: 'Kelola Layanan', href: '/admin/layanan', iconKey: 'kelolaLayanan', roles: ['admin', 'front_office'], group: 'pengelolaan' },
  { label: 'Topik Penanganan', href: '/admin/topik', iconKey: 'topik', roles: ['admin'], group: 'pengelolaan' },
  { label: 'Kelola Layar', href: '/admin/layar', iconKey: 'layar', roles: ['admin'], group: 'pengelolaan' },

  // Kemitraan & Investasi
  { label: 'UMKM', href: '/admin/umkm', iconKey: 'umkm', roles: ['admin'], group: 'kemitraan' },
  { label: 'Lead Investasi', href: '/admin/investasi-leads', iconKey: 'leads', roles: ['admin'], group: 'kemitraan' },
  { label: 'Investment Gallery', href: '/admin/gallery', iconKey: 'gallery', roles: ['admin'], group: 'kemitraan' },

  // Konten & Dokumen
  { label: 'Dokumen Peraturan', href: '/admin/dokumen', iconKey: 'dokumen', roles: ['admin'], group: 'konten' },
  { label: 'Konten Landing', href: '/admin/settings/landing', iconKey: 'landing', roles: ['admin'], group: 'konten' },

  // Sistem & Keamanan
  { label: 'Kelola Petugas', href: '/admin/petugas', iconKey: 'petugas', roles: ['admin'], group: 'sistem' },
  { label: 'Pengaturan', href: '/admin/settings', iconKey: 'settings', roles: ['admin'], group: 'sistem' },
  { label: 'Pengaturan AI', href: '/admin/settings/ai', iconKey: 'ai', roles: ['admin'], group: 'sistem' },
  { label: 'Tata Kelola Data', href: '/admin/data-governance', iconKey: 'governance', roles: ['admin'], group: 'sistem' },
  { label: 'Riwayat Perubahan', href: '/admin/riwayat', iconKey: 'riwayat', roles: ['admin'], group: 'sistem' },

  // Tautan tunggal paling bawah.
  { label: 'Profil Saya', href: '/admin/profil', iconKey: 'profil', roles: ['admin', 'petugas', 'front_office'], slot: 'bawah' },
  { label: 'Tampilan Publik', href: '/', iconKey: 'public', roles: ['admin', 'petugas', 'front_office'], slot: 'bawah' },
];

export type AdminNavTreeItem =
  | { type: 'link'; entry: AdminNavEntry }
  | { type: 'group'; group: AdminNavGroup; children: AdminNavEntry[] };

// Susun pohon menu sidebar untuk satu role. Murni: tidak mengubah ADMIN_NAV.
// - entri yang role-nya tidak mencakup `role` dibuang (urutan relatif tetap);
// - kelompok kosong disembunyikan; kelompok dengan 1 entri menjadi tautan biasa;
// - role tak dikenal/kosong -> pohon kosong.
export function buildNavTree(role: string | null | undefined): AdminNavTreeItem[] {
  if (!role) return [];
  const boleh = (e: AdminNavEntry) => (e.roles as string[]).includes(role);
  const links = (slot: 'atas' | 'bawah'): AdminNavTreeItem[] =>
    ADMIN_NAV
      .filter((e) => !e.hidden && !e.group && (e.slot ?? 'atas') === slot && boleh(e))
      .map((entry) => ({ type: 'link', entry }));

  const groups: AdminNavTreeItem[] = [];
  for (const group of ADMIN_NAV_GROUPS) {
    const children = ADMIN_NAV.filter((e) => !e.hidden && e.group === group.key && boleh(e));
    if (children.length === 0) continue;
    if (children.length === 1) groups.push({ type: 'link', entry: children[0] });
    else groups.push({ type: 'group', group, children });
  }
  return [...links('atas'), ...groups, ...links('bawah')];
}

// Entri menu yang aktif untuk pathname: tepat satu (paling spesifik), atau undefined.
// '/' dan '/admin' hanya cocok exact; selain itu exact dulu, lalu prefiks terpanjang
// (batas "/" sehingga /admin/rekap-fo bukan anak /admin/rekap). Halaman tersembunyi
// (mis. /admin/scan) dipetakan ke entri sidebar penggantinya (`tampilSebagai`).
export function findActiveNavEntry(pathname: string): AdminNavEntry | undefined {
  const exact = ADMIN_NAV.find((e) => e.href === pathname);
  const cocok =
    exact ??
    ADMIN_NAV
      .filter((e) => e.href !== '/' && e.href !== '/admin' && pathname.startsWith(`${e.href}/`))
      .sort((a, b) => b.href.length - a.href.length)[0];
  if (cocok?.hidden && cocok.tampilSebagai) {
    return ADMIN_NAV.find((e) => e.href === cocok.tampilSebagai && !e.hidden) ?? cocok;
  }
  return cocok;
}

// Kelompok yang memuat halaman aktif (null bila halaman tautan tunggal/tak terdaftar).
export function findGroupForPath(pathname: string): AdminNavGroupKey | null {
  return findActiveNavEntry(pathname)?.group ?? null;
}

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
