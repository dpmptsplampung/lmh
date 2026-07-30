// Uji helper zona waktu Asia/Jakarta (RPT-07 / I-21 / SK-31).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { todayWIB, toWIBDateString, addDaysWIB } from './time';

// Helper: set waktu sistem palsu ke instan UTC tertentu.
function setNow(isoUtc: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(isoUtc));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('toWIBDateString', () => {
  it('mengembalikan tanggal menurut kalender Asia/Jakarta', () => {
    // 2026-07-29 16:00 UTC = 2026-07-29 23:00 WIB -> masih tanggal 29 di WIB.
    expect(toWIBDateString(new Date('2026-07-29T16:00:00Z'))).toBe('2026-07-29');
  });

  it('tidak menggeser tanggal pada jam 00:00–07:00 WIB (kasus bug UTC)', () => {
    // 2026-07-29 18:00 UTC = 2026-07-30 01:00 WIB -> di WIB sudah tanggal 30.
    // Dengan pola lama (toISOString().split) hasilnya '2026-07-29' (UTC) = SALAH.
    expect(toWIBDateString(new Date('2026-07-29T18:00:00Z'))).toBe('2026-07-30');
  });
});

describe('todayWIB', () => {
  it('SK-31: check-in 23:50 WIB masuk hari kalender yang benar', () => {
    // 23:50 WIB = 16:50 UTC pada hari yang sama.
    setNow('2026-07-29T16:50:00Z');
    expect(todayWIB()).toBe('2026-07-29');
  });

  it('SK-31: check-in 00:10 WIB sudah hari berikutnya', () => {
    // 00:10 WIB = 17:10 UTC hari sebelumnya.
    setNow('2026-07-29T17:10:00Z');
    expect(todayWIB()).toBe('2026-07-30');
  });

  it('SK-31: reset antrean terjadi tengah malam WIB, BUKAN 07:00 WIB', () => {
    // 06:30 WIB = 23:30 UTC hari sebelumnya.
    setNow('2026-07-29T23:30:00Z');
    expect(todayWIB()).toBe('2026-07-30');
    // Pola UTC lama akan menganggap ini masih 2026-07-29 -> bug. Di sini sudah benar.
  });
});

describe('addDaysWIB', () => {
  it('menambah N hari pada kalender WIB (untuk horizon reservasi H+7)', () => {
    setNow('2026-07-29T17:00:00Z'); // = 2026-07-30 00:00 WIB
    expect(addDaysWIB(7)).toBe('2026-08-06');
  });

  it('mundur dengan angka negatif', () => {
    expect(addDaysWIB(-1, new Date('2026-07-29T16:00:00Z'))).toBe('2026-07-28');
  });

  it('melewati batas bulan dengan benar', () => {
    expect(addDaysWIB(3, new Date('2026-07-30T16:00:00Z'))).toBe('2026-08-02');
  });
});
