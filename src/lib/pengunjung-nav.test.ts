import { describe, expect, it } from 'vitest';
import { cariEntriPengunjungAktif, PENGUNJUNG_NAV } from './pengunjung-nav';

describe('PENGUNJUNG_NAV', () => {
  it('berisi tujuh menu utama, urut', () => {
    const utama = PENGUNJUNG_NAV.filter((e) => e.slot !== 'bawah');
    expect(utama.map((e) => [e.label, e.href])).toEqual([
      ['Beranda saya', '/me'],
      ['Reservasi', '/me/reservasi'],
      ['Usaha saya', '/me/usaha'],
      ['Cari pemasok', '/me/umkm'],
      ['Notifikasi', '/me/notifications'],
      ['Chat', '/chat'],
      ['Lacak pengaduan', '/pengaduan/lacak'],
    ]);
  });

  it('hanya Notifikasi yang berlencana', () => {
    expect(PENGUNJUNG_NAV.filter((e) => e.badgeKey).map((e) => e.href)).toEqual(['/me/notifications']);
  });

  it('href unik', () => {
    const h = PENGUNJUNG_NAV.map((e) => e.href);
    expect(new Set(h).size).toBe(h.length);
  });

  it('tautan bawah menuju situs utama', () => {
    expect(PENGUNJUNG_NAV.filter((e) => e.slot === 'bawah').map((e) => e.href)).toEqual(['/']);
  });
});

describe('cariEntriPengunjungAktif', () => {
  it('cocok persis dan awalan', () => {
    expect(cariEntriPengunjungAktif('/me')?.label).toBe('Beranda saya');
    expect(cariEntriPengunjungAktif('/me/')?.label).toBe('Beranda saya');
    expect(cariEntriPengunjungAktif('/me/reservasi')?.label).toBe('Reservasi');
    expect(cariEntriPengunjungAktif('/me/reservasi/x')?.label).toBe('Reservasi');
    expect(cariEntriPengunjungAktif('/me/notifications')?.label).toBe('Notifikasi');
    expect(cariEntriPengunjungAktif('/chat')?.label).toBe('Chat');
    expect(cariEntriPengunjungAktif('/me/usaha/abc')?.label).toBe('Usaha saya');
    expect(cariEntriPengunjungAktif('/me/umkm')?.label).toBe('Cari pemasok');
    expect(cariEntriPengunjungAktif('/pengaduan/lacak')?.label).toBe('Lacak pengaduan');
  });

  it('/me tidak menelan anak rute dan path asing tidak aktif', () => {
    expect(cariEntriPengunjungAktif('/me/lain')).toBeUndefined();
    expect(cariEntriPengunjungAktif('/')).toBeUndefined();
    expect(cariEntriPengunjungAktif('/chatx')).toBeUndefined();
    expect(cariEntriPengunjungAktif(null)).toBeUndefined();
  });
});
