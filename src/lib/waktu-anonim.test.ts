import { describe, expect, it } from 'vitest';
import { tampilWaktuLaporan, tepatTengahMalamWIB } from './waktu-anonim';

// 2026-11-01 17:00:00Z = 2026-11-02 00:00:00 WIB (UTC+7).
const TENGAH_MALAM_WIB = '2026-11-01T17:00:00Z';
const SIANG_WIB = '2026-11-02T05:30:00Z'; // 12:30 WIB

describe('tampilWaktuLaporan', () => {
  it('baris anonim: tanggal saja, tanpa jam 00.00 yang menyesatkan', () => {
    const teks = tampilWaktuLaporan(TENGAH_MALAM_WIB, true);
    expect(teks).toContain('2 November 2026');
    expect(teks).not.toMatch(/\d{1,2}[.:]\d{2}/);
  });

  it('baris anonim: jam tetap disembunyikan walau nilainya bukan tengah malam', () => {
    const teks = tampilWaktuLaporan(SIANG_WIB, true);
    expect(teks).toContain('2 November 2026');
    expect(teks).not.toMatch(/\d{1,2}[.:]\d{2}/);
  });

  it('baris tidak anonim: tanggal dan jam WIB', () => {
    expect(tampilWaktuLaporan(SIANG_WIB, false)).toMatch(/2 November 2026.*12[.:]30/);
  });

  it('baris tidak anonim tepat 00.00 WIB tetap menampilkan jam', () => {
    expect(tampilWaktuLaporan(TENGAH_MALAM_WIB, false)).toMatch(/2 November 2026.*00[.:]00/);
  });

  it('anonim tidak diketahui (undefined/null): perlakukan seperti tidak anonim', () => {
    expect(tampilWaktuLaporan(SIANG_WIB, undefined)).toMatch(/12[.:]30/);
    expect(tampilWaktuLaporan(SIANG_WIB, null)).toMatch(/12[.:]30/);
  });

  it('anonim "otomatis": tengah malam WIB tepat jadi tanggal saja, selain itu dengan jam', () => {
    expect(tampilWaktuLaporan(TENGAH_MALAM_WIB, 'otomatis')).not.toMatch(/\d{1,2}[.:]\d{2}/);
    expect(tampilWaktuLaporan(SIANG_WIB, 'otomatis')).toMatch(/12[.:]30/);
  });

  it('tanggal mengikuti WIB, bukan UTC', () => {
    // 23:00Z tanggal 1 = 06:00 WIB tanggal 2.
    expect(tampilWaktuLaporan('2026-11-01T23:00:00Z', true)).toContain('2 November 2026');
  });
});

describe('tepatTengahMalamWIB', () => {
  it('benar hanya untuk 00:00:00.000 WIB', () => {
    expect(tepatTengahMalamWIB(TENGAH_MALAM_WIB)).toBe(true);
    expect(tepatTengahMalamWIB('2026-11-01T17:00:00.001Z')).toBe(false);
    expect(tepatTengahMalamWIB('2026-11-01T17:01:00Z')).toBe(false);
    expect(tepatTengahMalamWIB('bukan tanggal')).toBe(false);
  });
});
