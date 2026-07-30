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
  });

  it('front_office TIDAK dapat mengakses halaman admin-only', () => {
    expect(canAccessAdminPath('front_office', '/admin')).toBe(false);
    expect(canAccessAdminPath('front_office', '/admin/petugas')).toBe(false);
    expect(canAccessAdminPath('front_office', '/admin/petugas/invite')).toBe(false);
    expect(canAccessAdminPath('front_office', '/admin/settings')).toBe(false);
    expect(canAccessAdminPath('front_office', '/admin/settings/landing')).toBe(false);
    expect(canAccessAdminPath('front_office', '/admin/umkm')).toBe(false);
    expect(canAccessAdminPath('front_office', '/admin/gallery')).toBe(false);
    expect(canAccessAdminPath('front_office', '/admin/data-governance')).toBe(false);
    expect(canAccessAdminPath('front_office', '/admin/chat/ai-log')).toBe(false);
    expect(canAccessAdminPath('front_office', '/admin/chat/faq')).toBe(false);
  });
});
