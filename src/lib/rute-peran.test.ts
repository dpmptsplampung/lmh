import { describe, expect, it } from 'vitest';
import { ADMIN_NAV } from './admin-nav';
import {
  alihkanAreaPeran,
  areaPeran,
  berandaPeran,
  berandaTolak,
  halamanProfilPeran,
  padananPetugas,
} from './rute-peran';

describe('beranda dan profil per peran', () => {
  it('berandaPeran: petugas ke Antrean petugas, admin dan FO ke /admin, lainnya null', () => {
    expect(berandaPeran('petugas')).toBe('/petugas/antrean');
    expect(berandaPeran('admin')).toBe('/admin');
    expect(berandaPeran('front_office')).toBe('/admin');
    expect(berandaPeran('pengunjung')).toBeNull();
    expect(berandaPeran(null)).toBeNull();
    expect(berandaPeran(undefined)).toBeNull();
  });
  it('berandaTolak selalu halaman yang boleh dibuka perannya', () => {
    expect(berandaTolak('petugas')).toBe('/petugas/antrean');
    expect(berandaTolak('admin')).toBe('/admin/antrian');
    expect(berandaTolak('front_office')).toBe('/admin/antrian');
    expect(berandaTolak('pengunjung')).toBe('/me');
  });
  it('halamanProfilPeran dan areaPeran', () => {
    expect(halamanProfilPeran('petugas')).toBe('/petugas/profil');
    expect(halamanProfilPeran('admin')).toBe('/admin/profil');
    expect(halamanProfilPeran('front_office')).toBe('/admin/profil');
    expect(areaPeran('petugas')).toBe('/petugas');
    expect(areaPeran('admin')).toBe('/admin');
  });
});

describe('padananPetugas', () => {
  it.each([
    ['/admin/antrian', '/petugas/antrean'],
    ['/admin/absensi', '/petugas/absensi'],
    ['/admin/chat', '/petugas/chat'],
    ['/admin/chat/faq', '/petugas/chat/faq'],
    ['/admin/chat/faq/baru', '/petugas/chat/faq/baru'],
    ['/admin/rekap', '/petugas/rekap'],
    ['/admin/profil', '/petugas/profil'],
    ['/admin/umkm-tugas', '/petugas/umkm/tugas'],
    ['/admin/umkm-laporan', '/petugas/umkm/laporan'],
  ])('%s -> %s', (dari, ke) => expect(padananPetugas(dari)).toBe(ke));

  it.each([
    '/admin', '/admin/kunjungan', '/admin/fo/registrasi', '/admin/chat/ai-log', '/admin/rekap-fo', '/admin/pengaduan',
    '/admin/settings/jadwal', '/admin/petugas', '/admin/halaman-baru', '/', '/me', '/petugas/antrean', '/administrator',
  ])('%s tanpa padanan', (dari) => expect(padananPetugas(dari)).toBeNull());

  it('semua entri ADMIN_NAV yang rolenya memuat petugas punya padanan (kecuali Tampilan Publik)', () => {
    for (const e of ADMIN_NAV.filter((x) => x.roles.includes('petugas') && x.href !== '/')) {
      expect(padananPetugas(e.href), e.href).toBe(e.hrefPetugas);
    }
  });
});

describe('alihkanAreaPeran', () => {
  it('petugas di /admin -> padanan atau Antrean; di /petugas -> null', () => {
    expect(alihkanAreaPeran('petugas', '/admin/chat/faq')).toBe('/petugas/chat/faq');
    expect(alihkanAreaPeran('petugas', '/admin/kunjungan')).toBe('/petugas/antrean');
    expect(alihkanAreaPeran('petugas', '/admin')).toBe('/petugas/antrean');
    expect(alihkanAreaPeran('petugas', '/petugas/chat')).toBeNull();
    expect(alihkanAreaPeran('petugas', '/me')).toBeNull();
  });
  it('admin dan FO di /petugas -> /admin; di /admin -> null', () => {
    for (const role of ['admin', 'front_office']) {
      expect(alihkanAreaPeran(role, '/petugas')).toBe('/admin');
      expect(alihkanAreaPeran(role, '/petugas/umkm/tugas')).toBe('/admin');
      expect(alihkanAreaPeran(role, '/admin/antrian')).toBeNull();
    }
  });
  it('peran asing tidak dialihkan (ditangani pemanggil)', () => {
    expect(alihkanAreaPeran('pengunjung', '/petugas/antrean')).toBeNull();
    expect(alihkanAreaPeran(null, '/admin')).toBeNull();
  });
  it('batas segmen: /petugasku dan /administrator bukan area staf', () => {
    expect(alihkanAreaPeran('admin', '/petugasku')).toBeNull();
    expect(alihkanAreaPeran('petugas', '/administrator')).toBeNull();
  });
});
