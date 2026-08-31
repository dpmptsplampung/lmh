import { describe, it, expect } from 'vitest';
import {
  determineFormType,
  isLayananPendataan,
  canAccessPelayananStaff,
} from './pelayanan';

describe('determineFormType', () => {
  it('mendeteksi layanan OSS dari nama', () => {
    expect(determineFormType('Helpdesk OSS')).toBe('oss');
    expect(determineFormType('konsultasi OSS')).toBe('oss');
  });

  it('mendeteksi layanan Perizinan dari nama', () => {
    expect(determineFormType('Perizinan DPMPTSP')).toBe('perizinan');
  });

  it('mengembalikan null untuk layanan lain', () => {
    expect(determineFormType('Pengaduan')).toBeNull();
    expect(determineFormType('SKM')).toBeNull();
  });
});

describe('isLayananPendataan', () => {
  it('true hanya untuk layanan OSS/Perizinan', () => {
    expect(isLayananPendataan('Helpdesk OSS')).toBe(true);
    expect(isLayananPendataan('Perizinan DPMPTSP')).toBe(true);
    expect(isLayananPendataan('Pengaduan')).toBe(false);
  });
});

describe('canAccessPelayananStaff', () => {
  const tiketLayanan = 'l-oss';

  it('admin dan front_office boleh akses semua layanan', () => {
    expect(canAccessPelayananStaff({ role: 'admin', layanan_id: null }, tiketLayanan)).toBe(true);
    expect(
      canAccessPelayananStaff({ role: 'front_office', layanan_id: 'l-lain' }, tiketLayanan)
    ).toBe(true);
  });

  it('petugas hanya boleh akses tiket pada layanan tempatnya bertugas', () => {
    expect(canAccessPelayananStaff({ role: 'petugas', layanan_id: 'l-oss' }, tiketLayanan)).toBe(
      true
    );
    expect(canAccessPelayananStaff({ role: 'petugas', layanan_id: 'l-lain' }, tiketLayanan)).toBe(
      false
    );
  });

  it('petugas tanpa layanan atau tiket tanpa layanan ditolak', () => {
    expect(canAccessPelayananStaff({ role: 'petugas', layanan_id: null }, tiketLayanan)).toBe(false);
    expect(canAccessPelayananStaff({ role: 'petugas', layanan_id: 'l-oss' }, null)).toBe(false);
  });

  it('role tak dikenal ditolak', () => {
    expect(canAccessPelayananStaff({ role: 'pengunjung', layanan_id: 'l-oss' }, tiketLayanan)).toBe(
      false
    );
  });
});
