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
});
