import { describe, expect, it } from 'vitest';
import { ADMIN_NAV, canAccessAdminPath } from './admin-nav';

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
