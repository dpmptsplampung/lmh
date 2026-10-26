import { describe, expect, it } from 'vitest';
import {
  ADMIN_BADGE_ROLES,
  ADMIN_NAV,
  ADMIN_NAV_GROUPS,
  badgeKeysForRole,
  buildNavTree,
  canAccessAdminPath,
  findActiveNavEntry,
  findGroupForPath,
  type AdminNavTreeItem,
  type AdminRole,
} from './admin-nav';

describe('canAccessAdminPath', () => {
  it('admin can open every registered admin page', () => {
    for (const entry of ADMIN_NAV) {
      if (entry.href === '/') continue;
      expect(canAccessAdminPath('admin', entry.href)).toBe(true);
    }
  });

  it('petugas can open their scoped pages', () => {
    expect(canAccessAdminPath('petugas', '/admin/antrian')).toBe(true);
    expect(canAccessAdminPath('petugas', '/admin/absensi')).toBe(true);
    expect(canAccessAdminPath('petugas', '/admin/chat')).toBe(true);
    expect(canAccessAdminPath('petugas', '/admin/chat/faq')).toBe(true);
    expect(canAccessAdminPath('petugas', '/admin/skm')).toBe(true);
    expect(canAccessAdminPath('petugas', '/admin/settings/jadwal')).toBe(true);
  });

  it('petugas is blocked from admin-only pages', () => {
    expect(canAccessAdminPath('petugas', '/admin')).toBe(false);
    expect(canAccessAdminPath('petugas', '/admin/kunjungan')).toBe(false);
    expect(canAccessAdminPath('petugas', '/admin/petugas')).toBe(false);
    expect(canAccessAdminPath('petugas', '/admin/petugas/invite')).toBe(false);
    expect(canAccessAdminPath('petugas', '/admin/settings')).toBe(false);
    expect(canAccessAdminPath('petugas', '/admin/settings/landing')).toBe(false);
    expect(canAccessAdminPath('petugas', '/admin/chat/ai-log')).toBe(false);
    expect(canAccessAdminPath('petugas', '/admin/data-governance')).toBe(false);
  });

  it('nested path inherits the most specific parent entry', () => {
    // /admin/chat/ai-log lebih spesifik dari /admin/chat → admin-only
    expect(canAccessAdminPath('petugas', '/admin/chat/ai-log')).toBe(false);
    // /admin/settings/jadwal lebih spesifik dari /admin/settings → petugas boleh
    expect(canAccessAdminPath('petugas', '/admin/settings/jadwal')).toBe(true);
  });

  it('unregistered admin path fails closed (admin only)', () => {
    expect(canAccessAdminPath('petugas', '/admin/halaman-baru')).toBe(false);
    expect(canAccessAdminPath('admin', '/admin/halaman-baru')).toBe(true);
  });

  it('front_office dapat mengakses wewenang lintas-layanan (RBA-02/CHT-08)', () => {
    // Wewenang operasional lintas layanan:
    expect(canAccessAdminPath('front_office', '/admin/antrian')).toBe(true);
    expect(canAccessAdminPath('front_office', '/admin/absensi')).toBe(true);
    expect(canAccessAdminPath('front_office', '/admin/chat')).toBe(true);
    expect(canAccessAdminPath('front_office', '/admin/kunjungan')).toBe(true);
    expect(canAccessAdminPath('front_office', '/admin/scan')).toBe(true);
    expect(canAccessAdminPath('front_office', '/admin/skm')).toBe(true);
    expect(canAccessAdminPath('front_office', '/admin/pengaduan')).toBe(true);
    expect(canAccessAdminPath('front_office', '/admin/settings/jadwal')).toBe(true);
    // Keputusan CEO: FO punya dashboard seperti Admin.
    expect(canAccessAdminPath('front_office', '/admin')).toBe(true);
  });

  it('front_office TIDAK dapat mengakses halaman admin-only', () => {
    expect(canAccessAdminPath('front_office', '/admin/petugas')).toBe(false);
    expect(canAccessAdminPath('front_office', '/admin/petugas/invite')).toBe(false);
    expect(canAccessAdminPath('front_office', '/admin/settings')).toBe(false);
    expect(canAccessAdminPath('front_office', '/admin/settings/landing')).toBe(false);
    expect(canAccessAdminPath('front_office', '/admin/umkm')).toBe(false);
    expect(canAccessAdminPath('front_office', '/admin/gallery')).toBe(false);
    expect(canAccessAdminPath('front_office', '/admin/data-governance')).toBe(false);
    expect(canAccessAdminPath('front_office', '/admin/chat/ai-log')).toBe(false);
  });

  it('front_office dapat mengakses Kelola FAQ (hanya FAQ umum; dibatasi RLS faq_fo_umum), tetangganya tetap tertutup', () => {
    expect(canAccessAdminPath('front_office', '/admin/chat/faq')).toBe(true);
    // Entri paling spesifik menang: izin FAQ tidak merembes ke /admin/chat/ai-log (admin-only).
    expect(canAccessAdminPath('front_office', '/admin/chat/ai-log')).toBe(false);
    const entri = ADMIN_NAV.find((e) => e.href === '/admin/chat/faq');
    expect(entri?.roles).toEqual(['admin', 'petugas', 'front_office']);
  });

  it('peran lain tidak berubah untuk Kelola FAQ: admin dan petugas boleh, peran tak dikenal ditolak', () => {
    expect(canAccessAdminPath('admin', '/admin/chat/faq')).toBe(true);
    expect(canAccessAdminPath('petugas', '/admin/chat/faq')).toBe(true);
    expect(canAccessAdminPath('pengunjung' as never, '/admin/chat/faq')).toBe(false);
  });
  // Alur Front Office (Tahap B): halaman /admin/fo/*, topik, rekap FO, performa.
  describe('halaman alur Front Office', () => {
    const HALAMAN_FO = ['/admin/fo/kotak-masuk', '/admin/fo/penanganan', '/admin/fo/daftar'];

    it('admin dan front_office boleh membuka halaman /admin/fo/*', () => {
      for (const href of HALAMAN_FO) {
        expect(canAccessAdminPath('admin', href)).toBe(true);
        expect(canAccessAdminPath('front_office', href)).toBe(true);
      }
    });

    it('petugas layanan TIDAK boleh membuka halaman /admin/fo/* (termasuk sub-path yang belum terdaftar)', () => {
      for (const href of [...HALAMAN_FO, '/admin/fo/halaman-baru']) {
        expect(canAccessAdminPath('petugas', href)).toBe(false);
      }
    });

    it('/admin/topik hanya admin', () => {
      expect(canAccessAdminPath('admin', '/admin/topik')).toBe(true);
      expect(canAccessAdminPath('front_office', '/admin/topik')).toBe(false);
      expect(canAccessAdminPath('petugas', '/admin/topik')).toBe(false);
    });

    it('/admin/rekap-fo untuk admin dan front_office; /admin/performa hanya admin', () => {
      expect(canAccessAdminPath('admin', '/admin/rekap-fo')).toBe(true);
      expect(canAccessAdminPath('front_office', '/admin/rekap-fo')).toBe(true);
      expect(canAccessAdminPath('petugas', '/admin/rekap-fo')).toBe(false);
      expect(canAccessAdminPath('admin', '/admin/performa')).toBe(true);
      expect(canAccessAdminPath('front_office', '/admin/performa')).toBe(false);
      expect(canAccessAdminPath('petugas', '/admin/performa')).toBe(false);
    });

    it('/admin/rekap-fo tidak mewarisi izin /admin/rekap (prefiks harus diikuti "/")', () => {
      const rekap = ADMIN_NAV.find((e) => e.href === '/admin/rekap');
      expect(rekap?.roles).toContain('petugas');
      expect(canAccessAdminPath('petugas', '/admin/rekap-fo')).toBe(false);
    });

    it('semua entri baru terdaftar sekali dengan iconKey unik per entri', () => {
      const hrefBaru = [...HALAMAN_FO, '/admin/topik', '/admin/rekap-fo', '/admin/performa'];
      for (const href of hrefBaru) {
        expect(ADMIN_NAV.filter((e) => e.href === href)).toHaveLength(1);
      }
      const kunci = hrefBaru.map((h) => ADMIN_NAV.find((e) => e.href === h)?.iconKey);
      expect(new Set(kunci).size).toBe(hrefBaru.length);
    });

    it('semua href di ADMIN_NAV unik', () => {
      const hrefs = ADMIN_NAV.map((e) => e.href);
      expect(new Set(hrefs).size).toBe(hrefs.length);
    });
  });
});

// ---------------------------------------------------------------------------
// Pengelompokan menu sidebar (dropdown) + urutan prioritas + badge.
// ---------------------------------------------------------------------------

const A = 'admin', P = 'petugas', F = 'front_office';
// Snapshot role per href SEBELUM pengelompokan: pengelompokan hanya presentasi, akses tidak boleh berubah.
const ROLES_SEBELUM: Record<string, string[]> = {
  '/': [A, P, F], '/admin': [A, F], '/admin/absensi': [A, P, F], '/admin/antrian': [A, P, F],
  '/admin/buku-tamu': [A, F], '/admin/chat': [A, P, F], '/admin/chat/ai-log': [A],
  '/admin/chat/faq': [A, P, F], '/admin/data-governance': [A], '/admin/dokumen': [A],
  '/admin/fo/daftar': [A, F], '/admin/fo/kotak-masuk': [A, F], '/admin/fo/penanganan': [A, F],
  '/admin/fo/registrasi': [A, F], '/admin/gallery': [A], '/admin/investasi-leads': [A], '/admin/kunjungan': [A, F],
  '/admin/layanan': [A, F], '/admin/layar': [A], '/admin/pengaduan': [A, P, F], '/admin/performa': [A],
  '/admin/petugas': [A], '/admin/profil': [A, P, F], '/admin/rekap': [A, P, F], '/admin/rekap-fo': [A, F],
  '/admin/riwayat': [A], '/admin/scan': [A, F], '/admin/settings': [A], '/admin/settings/ai': [A],
  '/admin/settings/jadwal': [A, P, F], '/admin/settings/landing': [A], '/admin/skm': [A, P, F],
  '/admin/topik': [A], '/admin/umkm': [A],
};

// Halaman lama yang digabung ke /admin/fo/registrasi: tersembunyi dari sidebar, tetap boleh dibuka.
// Fase 3: /admin/rekap-fo kini redirect ke Rekap terpadu (tersembunyi, tetap admin + front_office).
const HIDDEN = ['/admin/fo/daftar', '/admin/scan', '/admin/rekap-fo'];

const urutanHref = (items: AdminNavTreeItem[]) =>
  items.flatMap((i) => (i.type === 'link' ? [i.entry.href] : i.children.map((c) => c.href)));

// Bentuk ringkas pohon: tautan = href, grup = [label, ...href anak].
const bentuk = (role: string) =>
  buildNavTree(role).map((i) => (i.type === 'link' ? i.entry.href : [i.group.label, ...i.children.map((c) => c.href)]));

describe('pengelompokan menu: data', () => {
  it('setiap href lama muncul tepat sekali dan role-nya tidak berubah', () => {
    expect(ADMIN_NAV.map((e) => e.href).sort()).toEqual(Object.keys(ROLES_SEBELUM).sort());
    for (const e of ADMIN_NAV) expect(e.roles, e.href).toEqual(ROLES_SEBELUM[e.href]);
  });

  it('urutan grup (atas ke bawah) sesuai prioritas pemakaian harian', () => {
    expect(ADMIN_NAV_GROUPS.map((g) => g.label)).toEqual([
      'Front Office', 'Antrean & Kehadiran', 'Layanan Online', 'Laporan & Evaluasi',
      'Pengelolaan Layanan', 'Kemitraan & Investasi', 'Konten & Dokumen', 'Sistem & Keamanan',
    ]);
  });

  it('urutan menu di dalam tiap grup sesuai prioritas', () => {
    const anak = (key: string) => ADMIN_NAV.filter((e) => !e.hidden && e.group === key).map((e) => e.label);
    expect(anak('frontOffice')).toEqual(['Registrasi Pengunjung', 'Kotak Masuk FO', 'Penanganan']);
    expect(anak('antrean')).toEqual(['Antrian', 'Absensi', 'Kunjungan', 'Buku Tamu']);
    expect(anak('layananOnline')).toEqual(['Live Chat', 'Pengaduan', 'Kelola FAQ', 'Log AI Chat']);
    expect(anak('laporan')).toEqual(['Rekap', 'Hasil SKM', 'Performa Pelayanan']);
    expect(anak('pengelolaan')).toEqual(['Jadwal Layanan', 'Kelola Layanan', 'Topik Penanganan', 'Kelola Layar']);
    expect(anak('kemitraan')).toEqual(['UMKM', 'Lead Investasi', 'Investment Gallery']);
    expect(anak('konten')).toEqual(['Dokumen Peraturan', 'Konten Landing']);
    expect(anak('sistem')).toEqual(['Kelola Petugas', 'Pengaturan', 'Pengaturan AI', 'Tata Kelola Data', 'Riwayat Perubahan']);
  });

  it('setiap grup berisi 2-5 menu dan key grup di entri valid', () => {
    const keys = new Set(ADMIN_NAV_GROUPS.map((g) => g.key));
    for (const e of ADMIN_NAV) if (e.group) expect(keys.has(e.group)).toBe(true);
    for (const g of ADMIN_NAV_GROUPS) {
      const n = ADMIN_NAV.filter((e) => !e.hidden && e.group === g.key).length;
      expect(n, g.label).toBeGreaterThanOrEqual(2);
      expect(n, g.label).toBeLessThanOrEqual(5);
    }
  });
});

describe('buildNavTree', () => {
  it('admin: semua grup, Dashboard di atas, Profil + Tampilan Publik di bawah', () => {
    const t = bentuk('admin');
    expect(t[0]).toBe('/admin');
    expect(t.slice(-2)).toEqual(['/admin/profil', '/']);
    expect(t.filter(Array.isArray).map((g) => g[0])).toEqual(ADMIN_NAV_GROUPS.map((g) => g.label));
    // Setiap href tepat sekali di pohon admin (admin berhak atas semuanya).
    expect(urutanHref(buildNavTree('admin')).sort()).toEqual(Object.keys(ROLES_SEBELUM).filter((h) => !HIDDEN.includes(h)).sort());
  });

  it('front_office: grup yang tersisa disaring, urutan relatif tetap', () => {
    expect(bentuk('front_office')).toEqual([
      '/admin',
      ['Front Office', '/admin/fo/registrasi', '/admin/fo/kotak-masuk', '/admin/fo/penanganan'],
      ['Antrean & Kehadiran', '/admin/antrian', '/admin/absensi', '/admin/kunjungan', '/admin/buku-tamu'],
      ['Layanan Online', '/admin/chat', '/admin/pengaduan', '/admin/chat/faq'],
      ['Laporan & Evaluasi', '/admin/rekap', '/admin/skm'],
      ['Pengelolaan Layanan', '/admin/settings/jadwal', '/admin/layanan'],
      '/admin/profil',
      '/',
    ]);
  });

  it('petugas: tanpa Dashboard/Front Office; grup 1-entri menjadi tautan biasa', () => {
    expect(bentuk('petugas')).toEqual([
      ['Antrean & Kehadiran', '/admin/antrian', '/admin/absensi'],
      ['Layanan Online', '/admin/chat', '/admin/pengaduan', '/admin/chat/faq'],
      ['Laporan & Evaluasi', '/admin/rekap', '/admin/skm'],
      '/admin/settings/jadwal', // Pengelolaan Layanan tinggal 1 entri -> tautan biasa
      '/admin/profil',
      '/',
    ]);
  });

  it('tiap pohon hanya memuat entri yang rolenya mencakup pengguna, tanpa duplikat', () => {
    for (const role of ['admin', 'petugas', 'front_office'] as AdminRole[]) {
      const hrefs = urutanHref(buildNavTree(role));
      expect(new Set(hrefs).size).toBe(hrefs.length);
      for (const h of hrefs) expect(ROLES_SEBELUM[h], `${role} ${h}`).toContain(role);
      // Persis semua entri yang boleh dilihat role tersebut.
      expect(hrefs.sort()).toEqual(Object.keys(ROLES_SEBELUM).filter((h) => ROLES_SEBELUM[h].includes(role) && !HIDDEN.includes(h)).sort());
    }
  });

  it('role kosong / tak dikenal -> pohon kosong; ADMIN_NAV tidak dimutasi', () => {
    const salinan = JSON.stringify(ADMIN_NAV);
    expect(buildNavTree(null)).toEqual([]);
    expect(buildNavTree(undefined)).toEqual([]);
    expect(buildNavTree('pengunjung')).toEqual([]);
    expect(JSON.stringify(ADMIN_NAV)).toBe(salinan);
  });
});

describe('findActiveNavEntry / findGroupForPath', () => {
  it('exact menang; prefiks terpanjang untuk path bersarang', () => {
    expect(findGroupForPath('/admin/chat')).toBe('layananOnline');
    expect(findGroupForPath('/admin/chat/faq')).toBe('layananOnline');
    expect(findActiveNavEntry('/admin/chat')?.href).toBe('/admin/chat');
    expect(findActiveNavEntry('/admin/chat/faq')?.href).toBe('/admin/chat/faq');
    expect(findActiveNavEntry('/admin/chat/ai-log')?.href).toBe('/admin/chat/ai-log');
    expect(findActiveNavEntry('/admin/chat/faq/baru')?.href).toBe('/admin/chat/faq');
    expect(findActiveNavEntry('/admin/chat/lain')?.href).toBe('/admin/chat');
    expect(findActiveNavEntry('/admin/settings')?.href).toBe('/admin/settings');
    expect(findActiveNavEntry('/admin/settings/jadwal')?.href).toBe('/admin/settings/jadwal');
    expect(findActiveNavEntry('/admin/settings/ai')?.href).toBe('/admin/settings/ai');
    expect(findActiveNavEntry('/admin/settings/landing')?.href).toBe('/admin/settings/landing');
    expect(findGroupForPath('/admin/settings')).toBe('sistem');
    expect(findGroupForPath('/admin/settings/ai')).toBe('sistem');
    expect(findGroupForPath('/admin/settings/jadwal')).toBe('pengelolaan');
    expect(findGroupForPath('/admin/settings/landing')).toBe('konten');
    expect(findGroupForPath('/admin/petugas/invite')).toBe('sistem');
  });

  it('/admin hanya exact untuk Dashboard; tidak menjadi induk halaman lain', () => {
    expect(findActiveNavEntry('/admin')?.href).toBe('/admin');
    expect(findGroupForPath('/admin')).toBeNull();
    expect(findActiveNavEntry('/admin/halaman-baru')).toBeUndefined();
    expect(findGroupForPath('/admin/halaman-baru')).toBeNull();
    expect(findActiveNavEntry('/')?.href).toBe('/');
    expect(findActiveNavEntry('/chat')).toBeUndefined();
  });

  it('batas prefiks "/": /admin/rekap-fo bukan anak /admin/rekap', () => {
    // Rekap Front Office lama tersembunyi dan dipetakan ke Rekap terpadu (Fase 3).
    expect(findActiveNavEntry('/admin/rekap-fo')?.href).toBe('/admin/rekap');
    expect(findActiveNavEntry('/admin/rekap')?.href).toBe('/admin/rekap');
    expect(findActiveNavEntry('/admin/rekap/x')?.href).toBe('/admin/rekap');
  });

  it('tepat satu menu aktif untuk setiap href terdaftar', () => {
    for (const e of ADMIN_NAV.filter((x) => !x.hidden)) expect(findActiveNavEntry(e.href)?.href).toBe(e.href);
  });

  it('tautan tunggal tidak punya grup', () => {
    expect(findGroupForPath('/admin/profil')).toBeNull();
    expect(findGroupForPath('/')).toBeNull();
  });
});

describe('peta badge menu', () => {
  it('peta href -> badge eksplisit, satu entri per badge', () => {
    const peta = Object.fromEntries(ADMIN_NAV.filter((e) => e.badgeKey).map((e) => [e.href, e.badgeKey]));
    expect(peta).toEqual({
      '/admin/fo/kotak-masuk': 'kotakMasukFo',
      '/admin/fo/penanganan': 'penangananFo',
      '/admin/antrian': 'antrian',
      '/admin/chat': 'liveChat',
      '/admin/pengaduan': 'pengaduan',
    });
    expect(Object.keys(ADMIN_BADGE_ROLES).sort()).toEqual(Object.values(peta).sort() as string[]);
  });

  it('role badge adalah himpunan bagian dari role entri (tidak ada badge pada menu yang tak bisa dibuka)', () => {
    for (const e of ADMIN_NAV) {
      if (!e.badgeKey) continue;
      for (const r of ADMIN_BADGE_ROLES[e.badgeKey]) expect(e.roles, `${e.href} ${r}`).toContain(r);
    }
  });

  it('badge per role', () => {
    expect(badgeKeysForRole('admin').sort()).toEqual(['antrian', 'kotakMasukFo', 'liveChat', 'penangananFo', 'pengaduan']);
    expect(badgeKeysForRole('front_office').sort()).toEqual(['antrian', 'kotakMasukFo', 'liveChat', 'penangananFo', 'pengaduan']);
    expect(badgeKeysForRole('petugas').sort()).toEqual(['antrian', 'liveChat']);
    expect(badgeKeysForRole(null)).toEqual([]);
    expect(badgeKeysForRole('pengunjung')).toEqual([]);
  });
});

describe('entri tersembunyi (halaman lama digabung ke Registrasi Pengunjung)', () => {
  it('hanya /admin/fo/daftar, /admin/scan, dan /admin/rekap-fo yang tersembunyi', () => {
    expect(ADMIN_NAV.filter((e) => e.hidden).map((e) => e.href).sort()).toEqual([...HIDDEN].sort());
  });

  it('tetap lolos canAccessAdminPath untuk admin dan front_office, tertutup untuk petugas', () => {
    for (const href of HIDDEN) {
      expect(canAccessAdminPath('admin', href)).toBe(true);
      expect(canAccessAdminPath('front_office', href)).toBe(true);
      expect(canAccessAdminPath('petugas', href)).toBe(false);
    }
    expect(canAccessAdminPath('front_office', '/admin/fo/registrasi')).toBe(true);
    expect(canAccessAdminPath('admin', '/admin/fo/registrasi')).toBe(true);
    expect(canAccessAdminPath('petugas', '/admin/fo/registrasi')).toBe(false);
  });

  it('tidak muncul di pohon sidebar maupun badge', () => {
    for (const role of ['admin', 'front_office']) {
      const hrefs = urutanHref(buildNavTree(role));
      for (const h of HIDDEN) expect(hrefs).not.toContain(h);
      expect(hrefs).toContain('/admin/fo/registrasi');
    }
    for (const e of ADMIN_NAV.filter((x) => x.hidden)) expect(e.badgeKey).toBeUndefined();
  });

  it('dipetakan ke grup Front Office dan menandai entri Registrasi Pengunjung sebagai aktif', () => {
    for (const href of ['/admin/fo/daftar', '/admin/scan', '/admin/fo/registrasi']) {
      expect(findGroupForPath(href), href).toBe('frontOffice');
      expect(findActiveNavEntry(href)?.href, href).toBe('/admin/fo/registrasi');
    }
    // Query string bukan bagian pathname: ?tab=scan tetap memetakan ke Registrasi.
    expect(findActiveNavEntry('/admin/fo/registrasi')?.label).toBe('Registrasi Pengunjung');
  });

  it('/admin/rekap-fo dipetakan ke Rekap terpadu (grup Laporan)', () => {
    expect(findGroupForPath('/admin/rekap-fo')).toBe('laporan');
    expect(findActiveNavEntry('/admin/rekap-fo')?.href).toBe('/admin/rekap');
  });
});
