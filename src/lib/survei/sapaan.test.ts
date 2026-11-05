import { describe, expect, it } from 'vitest';
import { buatSapaan, namaUntukSapaan, waktuSapaan } from './sapaan';

// Jam WIB = UTC+7. 03:00Z = 10:00 WIB, dst.
const wib = (jam: number, menit = 0) => new Date(Date.UTC(2026, 10, 3, jam - 7 + 24, menit)); // +24 menjaga jam tidak negatif

describe('waktuSapaan', () => {
  it.each([
    [3, 59, 'Malam'],
    [4, 0, 'Pagi'],
    [10, 59, 'Pagi'],
    [11, 0, 'Siang'],
    [14, 59, 'Siang'],
    [15, 0, 'Sore'],
    [17, 59, 'Sore'],
    [18, 0, 'Malam'],
    [0, 0, 'Malam'],
    [23, 59, 'Malam'],
  ])('%i:%i WIB -> %s', (jam, menit, harapan) => {
    expect(waktuSapaan(wib(jam, menit))).toBe(harapan);
  });

  it('memakai WIB, bukan zona proses (UTC 21:00 = 04:00 WIB hari berikutnya = Pagi)', () => {
    expect(waktuSapaan(new Date('2026-11-02T21:00:00Z'))).toBe('Pagi');
  });
});

describe('namaUntukSapaan', () => {
  it('merapikan spasi', () => expect(namaUntukSapaan('  Budi   Santoso ')).toBe('Budi Santoso'));
  it.each([null, undefined, '', '   ', '[anonim]', 'Anonim', 'tanpa nama', 'Tidak berlaku', '-', '--'])(
    'menganggap %j sebagai tanpa nama',
    (v) => expect(namaUntukSapaan(v)).toBeNull(),
  );
  it.each([
    ['tomi', 'Tomi'],
    ['budi santoso', 'Budi Santoso'],
    ['BUDI SANTOSO', 'Budi Santoso'],
    ['siti nur-aini', 'Siti Nur-Aini'],
    ["dewi o'connor", "Dewi O'Connor"],
  ])('merapikan huruf kapital nama yang ditulis seluruhnya kecil atau besar: %s', (masuk, harapan) => {
    expect(namaUntukSapaan(masuk)).toBe(harapan);
  });
  it.each(['Budi bin Ahmad', 'M. Rizki', 'Ir. H. Ahmad', 'McDonald', 'dr. Tomi'])(
    'tidak mengubah nama berhuruf campur: %s',
    (nama) => expect(namaUntukSapaan(nama)).toBe(nama),
  );
  it('memotong nama yang terlalu panjang', () => {
    const hasil = namaUntukSapaan('Ab'.repeat(50))!;
    expect(hasil.length).toBeLessThanOrEqual(61);
    expect(hasil.endsWith('…')).toBe(true);
  });
});

describe('buatSapaan', () => {
  it('menggabungkan salam dan nama', () => {
    expect(buatSapaan('Budi Santoso', wib(9))).toBe('Selamat Pagi, Budi Santoso');
    expect(buatSapaan('Siti', wib(13))).toBe('Selamat Siang, Siti');
    expect(buatSapaan('Andi', wib(16))).toBe('Selamat Sore, Andi');
  });
  it('tanpa nama hanya salam', () => {
    expect(buatSapaan(null, wib(9))).toBe('Selamat Pagi');
    expect(buatSapaan('[anonim]', wib(20))).toBe('Selamat Malam');
  });
});
