import { describe, expect, it } from 'vitest';
import { bacaParamAntrean, susunQueryAntrean } from './antrianUrl';

const HARI = '2026-11-16';
const UUID = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const baca = (q: string) => bacaParamAntrean(new URLSearchParams(q), HARI);

describe('antrianUrl: saringan Layanan (Admin/FO)', () => {
  it('tanpa parameter: semua Layanan (null)', () => {
    expect(baca('')).toEqual({ tanggal: HARI, status: 'aktif', layanan: null, halaman: 0 });
  });

  it('layanan berupa UUID dibaca; selain UUID ditolak (tidak pernah masuk kueri)', () => {
    expect(baca(`layanan=${UUID}`).layanan).toBe(UUID);
    expect(baca(`layanan=${UUID.toUpperCase()}`).layanan).toBe(UUID.toUpperCase());
    for (const buruk of ['', 'semua', "x' or 1=1 --", '123', `${UUID}x`]) {
      expect(baca(`layanan=${encodeURIComponent(buruk)}`).layanan).toBeNull();
    }
  });

  it('ditulis ke URL hanya bila dipilih; semua-bawaan = query kosong', () => {
    const dasar = { tanggal: HARI, status: 'aktif' as const, halaman: 0 };
    expect(susunQueryAntrean({ ...dasar, layanan: null }, HARI)).toBe('');
    expect(susunQueryAntrean({ ...dasar, layanan: UUID }, HARI)).toBe(`layanan=${UUID}`);
    expect(susunQueryAntrean({ tanggal: '2026-11-04', status: 'semua', layanan: UUID, halaman: 2 }, HARI)).toBe(
      `tanggal=2026-11-04&status=semua&layanan=${UUID}&halaman=3`,
    );
  });
});
