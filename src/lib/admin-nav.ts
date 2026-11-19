// Sumber kebenaran akses menu staf per role dan modul layanan.
// Sidebar menyaring menu; AdminGuard (klien) dan proxy.ts (server) memakai aturan yang sama untuk rute.
// Admin dan Front Office memakai /admin/*; Petugas memakai /petugas/* (entri dengan `hrefPetugas`, lihat PETUGAS_NAV).
// Menu modul (UMKM, Investasi: IPRO dan Kotak Masuk Investasi) hanya untuk petugas yang layanannya bermodul itu (layanan.modul via staf_modul()).

export type AdminRole = 'admin' | 'petugas' | 'front_office';

export type AdminNavGroupKey =
  | 'frontOffice' | 'antrean' | 'layananOnline' | 'pesanPerilaku' | 'laporan'
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
  { key: 'pesanPerilaku', label: 'Pesan Perilaku', iconKey: 'pesanPerilaku' },
  { key: 'laporan', label: 'Laporan & Evaluasi', iconKey: 'laporan' },
  { key: 'pengelolaan', label: 'Pengelolaan Layanan', iconKey: 'pengelolaan' },
  { key: 'kemitraan', label: 'Kemitraan & Investasi', iconKey: 'kemitraan' },
  { key: 'konten', label: 'Konten & Dokumen', iconKey: 'konten' },
  { key: 'sistem', label: 'Sistem & Keamanan', iconKey: 'sistem' },
];

// Badge notifikasi pada menu (jumlah data yang perlu dibuka). Sumber hitungan: lib/hooks/useNavBadges.ts.
export type AdminBadgeKey = 'kotakMasukFo' | 'liveChat' | 'penangananFo' | 'antrian' | 'pengaduan' | 'saran';

// Role yang berhak melihat tiap badge (juga menentukan kueri hitungan yang dijalankan).
// Sengaja eksplisit: tidak semua yang boleh MEMBUKA halaman perlu diberi badge (mis. petugas layanan
// hanya melihat pengaduan, tidak bisa menindaklanjuti, jadi tanpa badge pengaduan).
export const ADMIN_BADGE_ROLES: Record<AdminBadgeKey, AdminRole[]> = {
  kotakMasukFo: ['admin', 'front_office'],
  liveChat: ['admin', 'petugas', 'front_office'],
  penangananFo: ['admin', 'front_office'],
  antrian: ['admin', 'petugas', 'front_office'],
  pengaduan: ['admin', 'front_office'],
  // Saran: RLS tabel saran hanya admin dan Front Office; petugas layanan tidak melihat Saran.
  saran: ['admin', 'front_office'],
};

export function badgeKeysForRole(role: string | null | undefined): AdminBadgeKey[] {
  if (!role) return [];
  return (Object.keys(ADMIN_BADGE_ROLES) as AdminBadgeKey[]).filter((k) =>
    (ADMIN_BADGE_ROLES[k] as string[]).includes(role),
  );
}

// Modul layanan (kolom layanan.modul, fungsi DB staf_modul()). null/tidak ada = layanan tanpa modul.
export type ModulLayanan = 'umkm' | 'investasi';

export interface AdminNavContext {
  modul?: ModulLayanan | null;
}

export interface AdminNavEntry {
  // Entri khusus modul: petugas hanya boleh bila layanannya bermodul ini. Admin selalu lolos lewat role.
  butuhModul?: ModulLayanan;
  // Padanan rute untuk role petugas (/petugas/*). Wajib ada pada setiap entri yang rolenya memuat 'petugas'.
  hrefPetugas?: string;
  label: string;
  href: string;
  iconKey:
    | 'dashboard' | 'kunjungan' | 'scan' | 'antrian' | 'absensi' | 'chat'
    | 'faq' | 'umkm' | 'gallery' | 'leads' | 'skm' | 'aiLog' | 'governance'
    | 'petugas' | 'jadwal' | 'settings' | 'landing' | 'public' | 'pengaduan' | 'layar'
    | 'rekap' | 'dokumen' | 'profil' | 'kelolaLayanan' | 'bukuTamu' | 'riwayat' | 'ai'
    | 'kotakMasuk' | 'penanganan' | 'daftarFo' | 'topik' | 'rekapFo' | 'performa' | 'saran';
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
  { label: 'Dasbor', href: '/admin', iconKey: 'dashboard', roles: ['admin', 'front_office'] },

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
  { label: 'Antrean', href: '/admin/antrian', hrefPetugas: '/petugas/antrean', iconKey: 'antrian', roles: ['admin', 'petugas', 'front_office'], group: 'antrean', badgeKey: 'antrian' },
  { label: 'Absensi', href: '/admin/absensi', hrefPetugas: '/petugas/absensi', iconKey: 'absensi', roles: ['admin', 'petugas', 'front_office'], group: 'antrean' },
  { label: 'Kunjungan', href: '/admin/kunjungan', iconKey: 'kunjungan', roles: ['admin', 'front_office'], group: 'antrean' },
  { label: 'Buku Tamu', href: '/admin/buku-tamu', iconKey: 'bukuTamu', roles: ['admin', 'front_office'], group: 'antrean' },

  // Layanan Online
  { label: 'Live Chat', href: '/admin/chat', hrefPetugas: '/petugas/chat', iconKey: 'chat', roles: ['admin', 'petugas', 'front_office'], group: 'layananOnline', badgeKey: 'liveChat' },
  { label: 'Hasil Survei', href: '/admin/pesan-perilaku', iconKey: 'skm', roles: ['admin', 'front_office'], group: 'pesanPerilaku' },
  { label: 'Saran', href: '/admin/saran', iconKey: 'saran', roles: ['admin', 'front_office'], group: 'pesanPerilaku', badgeKey: 'saran' },
  { label: 'Pengaduan', href: '/admin/pengaduan', iconKey: 'pengaduan', roles: ['admin', 'front_office'], group: 'pesanPerilaku', badgeKey: 'pengaduan' },
  // Front Office hanya mengelola FAQ umum (layanan_id NULL; RLS faq_fo_umum, lihat src/lib/faq-scope.ts).
  { label: 'Kelola FAQ', href: '/admin/chat/faq', hrefPetugas: '/petugas/chat/faq', iconKey: 'faq', roles: ['admin', 'petugas', 'front_office'], group: 'layananOnline' },
  { label: 'Log AI Chat', href: '/admin/chat/ai-log', iconKey: 'aiLog', roles: ['admin'], group: 'layananOnline' },

  // Laporan & Evaluasi. Fase 3: satu halaman Rekap terpadu (lingkup data per orang/Koordinator ditegakkan DB, ADR 0003);
  // halaman lama Rekap Front Office kini redirect ke Rekap (entri tersembunyi agar tetap lolos AdminGuard).
  { label: 'Rekap', href: '/admin/rekap', hrefPetugas: '/petugas/rekap', iconKey: 'rekap', roles: ['admin', 'petugas', 'front_office'], group: 'laporan' },
  { label: 'Laporan UMKM', href: '/admin/umkm-laporan', hrefPetugas: '/petugas/umkm/laporan', iconKey: 'umkm',
    roles: ['admin', 'petugas'], group: 'laporan', butuhModul: 'umkm' },
  { label: 'Rekap Front Office', href: '/admin/rekap-fo', iconKey: 'rekapFo', roles: ['admin', 'front_office'], group: 'laporan', hidden: true, tampilSebagai: '/admin/rekap' },
  { label: 'Cetak Laporan Pesan Perilaku', href: '/admin/pesan-perilaku/cetak', iconKey: 'skm', roles: ['admin', 'front_office'], group: 'pesanPerilaku', hidden: true, tampilSebagai: '/admin/pesan-perilaku' },
  { label: 'Hasil Survei', href: '/admin/skm', iconKey: 'skm', roles: ['admin', 'front_office'], group: 'pesanPerilaku', hidden: true, tampilSebagai: '/admin/pesan-perilaku' },
  { label: 'Performa Pelayanan', href: '/admin/performa', iconKey: 'performa', roles: ['admin'], group: 'laporan' },

  // Pengelolaan Layanan
  { label: 'Jadwal Layanan', href: '/admin/settings/jadwal', iconKey: 'jadwal', roles: ['admin', 'front_office'], group: 'pengelolaan' },
  { label: 'Kelola Layanan', href: '/admin/layanan', iconKey: 'kelolaLayanan', roles: ['admin', 'front_office'], group: 'pengelolaan' },
  { label: 'Topik Penanganan', href: '/admin/topik', iconKey: 'topik', roles: ['admin'], group: 'pengelolaan' },
  { label: 'Kelola Layar', href: '/admin/layar', iconKey: 'layar', roles: ['admin'], group: 'pengelolaan' },

  // Kemitraan & Investasi
  { label: 'Tugas UMKM', href: '/admin/umkm-tugas', hrefPetugas: '/petugas/umkm/tugas', iconKey: 'umkm', roles: ['admin', 'petugas'], group: 'kemitraan', butuhModul: 'umkm' },
  { label: 'Pengawasan UMKM', href: '/admin/umkm-pengawasan', iconKey: 'umkm',
    roles: ['admin', 'front_office'], group: 'kemitraan' },
  { label: 'IPRO', href: '/admin/ipro', hrefPetugas: '/petugas/investasi/ipro', iconKey: 'gallery',
    roles: ['admin', 'petugas'], group: 'kemitraan', butuhModul: 'investasi' },
  { label: 'Kotak Masuk Investasi', href: '/admin/investasi-leads', hrefPetugas: '/petugas/investasi/kotak-masuk', iconKey: 'leads',
    roles: ['admin', 'petugas'], group: 'kemitraan', butuhModul: 'investasi' },
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
  { label: 'Profil Saya', href: '/admin/profil', hrefPetugas: '/petugas/profil', iconKey: 'profil', roles: ['admin', 'petugas', 'front_office'], slot: 'bawah' },
  { label: 'Tampilan Publik', href: '/', hrefPetugas: '/', iconKey: 'public', roles: ['admin', 'petugas', 'front_office'], slot: 'bawah' },
];

// Daftar entri menurut role: petugas memakai PETUGAS_NAV (href = /petugas/*), role lain memakai ADMIN_NAV.
// Turunan dari ADMIN_NAV supaya label, urutan, grup, dan role tidak punya dua sumber kebenaran.
function bangunNavPetugas(): AdminNavEntry[] {
  return ADMIN_NAV
    .filter((e) => e.hrefPetugas && (e.roles as string[]).includes('petugas'))
    .map((e) => ({ ...e, href: e.hrefPetugas as string }));
}
export const PETUGAS_NAV: AdminNavEntry[] = bangunNavPetugas();

function navUntuk(role: string): AdminNavEntry[] {
  return role === 'petugas' ? PETUGAS_NAV : ADMIN_NAV;
}

// butuhModul: admin selalu lolos (lewat role); petugas hanya bila layanannya bermodul itu.
function bolehEntri(e: AdminNavEntry, role: string, context: AdminNavContext): boolean {
  if (!(e.roles as string[]).includes(role)) return false;
  return !e.butuhModul || role === 'admin' || context.modul === e.butuhModul;
}

export type AdminNavTreeItem =
  | { type: 'link'; entry: AdminNavEntry }
  | { type: 'group'; group: AdminNavGroup; children: AdminNavEntry[] };

// Susun pohon menu sidebar untuk satu role. Murni: tidak mengubah ADMIN_NAV.
// - entri yang role-nya tidak mencakup `role` dibuang (urutan relatif tetap);
// - kelompok kosong disembunyikan; kelompok dengan 1 entri menjadi tautan biasa;
// - role tak dikenal/kosong -> pohon kosong.
export function buildNavTree(role: string | null | undefined, context: AdminNavContext = {}): AdminNavTreeItem[] {
  if (!role) return [];
  const boleh = (e: AdminNavEntry) => bolehEntri(e, role, context);
  const nav = navUntuk(role);
  const links = (slot: 'atas' | 'bawah'): AdminNavTreeItem[] =>
    nav
      .filter((e) => !e.hidden && !e.group && (e.slot ?? 'atas') === slot && boleh(e))
      .map((entry) => ({ type: 'link', entry }));

  const groups: AdminNavTreeItem[] = [];
  for (const group of ADMIN_NAV_GROUPS) {
    const children = nav.filter((e) => !e.hidden && e.group === group.key && boleh(e));
    if (children.length === 0) continue;
    if (children.length === 1) groups.push({ type: 'link', entry: children[0] });
    else groups.push({ type: 'group', group, children });
  }
  return [...links('atas'), ...groups, ...links('bawah')];
}

// Pathname berada di area tertentu (batas segmen: /petugasku bukan bagian dari /petugas).
export function dalamArea(pathname: string, area: '/admin' | '/petugas'): boolean {
  return pathname === area || pathname.startsWith(`${area}/`);
}

// Entri menu yang aktif untuk pathname: tepat satu (paling spesifik), atau undefined.
// '/' dan '/admin' hanya cocok exact; selain itu exact dulu, lalu prefiks terpanjang
// (batas "/" sehingga /admin/rekap-fo bukan anak /admin/rekap). Halaman tersembunyi
// (mis. /admin/scan) dipetakan ke entri sidebar penggantinya (`tampilSebagai`).
// Path di bawah /petugas dicari di PETUGAS_NAV; selebihnya di ADMIN_NAV.
export function findActiveNavEntry(pathname: string): AdminNavEntry | undefined {
  const daftar = dalamArea(pathname, '/petugas') ? PETUGAS_NAV : ADMIN_NAV;
  const exact = daftar.find((e) => e.href === pathname);
  const cocok =
    exact ??
    daftar
      .filter((e) => e.href !== '/' && e.href !== '/admin' && pathname.startsWith(`${e.href}/`))
      .sort((a, b) => b.href.length - a.href.length)[0];
  if (cocok?.hidden && cocok.tampilSebagai) {
    return daftar.find((e) => e.href === cocok.tampilSebagai && !e.hidden) ?? cocok;
  }
  return cocok;
}

// Kelompok yang memuat halaman aktif (null bila halaman tautan tunggal/tak terdaftar).
export function findGroupForPath(pathname: string): AdminNavGroupKey | null {
  return findActiveNavEntry(pathname)?.group ?? null;
}

// Entri paling spesifik untuk pathname di sebuah daftar: exact, lalu prefiks terpanjang ('/' dan '/admin'
// tidak pernah menjadi induk). undefined = tidak terdaftar.
function cariEntri(daftar: AdminNavEntry[], pathname: string): AdminNavEntry | undefined {
  const exact = daftar.find((e) => e.href === pathname);
  if (exact) return exact;
  return daftar
    .filter((e) => e.href !== '/' && e.href !== '/admin' && pathname.startsWith(`${e.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

// Apakah role boleh membuka pathname menurut tabel ADMIN_NAV (kecuali '/': publik). Murni tabel role;
// petugas memakai /petugas/*, jadi pengalihan area ditegakkan oleh bolehAksesRute dan proxy.
// Halaman /admin yang tidak terdaftar: hanya admin (fail-closed; '/admin' tidak mewariskan ke anak-anaknya).
export function canAccessAdminPath(role: AdminRole, pathname: string, context: AdminNavContext = {}): boolean {
  const entri = cariEntri(ADMIN_NAV, pathname);
  if (entri) return bolehEntri(entri, role, context);
  return role === 'admin';
}

// Gerbang rute tunggal (dipakai proxy di server dan AdminGuard di klien), fail-closed:
// - /petugas/*: hanya role petugas dan hanya rute terdaftar di PETUGAS_NAV (modul dicek lewat context);
//   '/petugas' sendiri hanya pintu masuk yang dialihkan ke Antrean.
// - /admin/*: admin dan front_office lewat canAccessAdminPath; petugas selalu ditolak (area-nya /petugas).
// - selain itu: ditolak (bukan area staf).
export function bolehAksesRute(role: AdminRole, pathname: string, context: AdminNavContext = {}): boolean {
  if (dalamArea(pathname, '/petugas')) {
    if (role !== 'petugas') return false;
    if (pathname === '/petugas') return true;
    const entri = cariEntri(PETUGAS_NAV, pathname);
    return !!entri && bolehEntri(entri, role, context);
  }
  if (dalamArea(pathname, '/admin')) {
    return role !== 'petugas' && canAccessAdminPath(role, pathname, context);
  }
  return false;
}

// Apakah membuka pathname memerlukan tahu modul layanan petugas (untuk memanggil staf_modul() hanya bila perlu).
export function butuhModulUntukRute(role: AdminRole, pathname: string): boolean {
  if (role !== 'petugas' || !dalamArea(pathname, '/petugas')) return false;
  return !!cariEntri(PETUGAS_NAV, pathname)?.butuhModul;
}
