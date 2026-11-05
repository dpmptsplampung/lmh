import { describe, expect, it } from 'vitest';
import {
  PILIHAN_CEPAT_BAWAAN,
  akhirBulan,
  akhirPekan,
  apitkan,
  apitkanRentang,
  awalBulan,
  awalPekan,
  bandingkanTanggal,
  diLuarBatas,
  formatBulanTahun,
  formatPanjang,
  formatPanjangDenganHari,
  formatPendek,
  formatRentangPanjang,
  formatRentangPendek,
  hariDalamBulan,
  hariPekan,
  kabisat,
  selisihHari,
  susunBulan,
  tambahBulan,
  tambahHari,
  tambahTahun,
  tanggalValid,
  uraiTanggal,
  urutkanRentang,
} from './tanggal';

describe('uraiTanggal / tanggalValid', () => {
  it('menerima tanggal nyata, termasuk 29 Februari tahun kabisat', () => {
    expect(uraiTanggal('2026-11-04')).toEqual({ tahun: 2026, bulan: 11, hari: 4 });
    expect(tanggalValid('2028-02-29')).toBe(true);
  });

  it('menolak format salah, tanggal yang tidak ada, dan bukan string', () => {
    for (const s of ['', '2026-1-4', '04-11-2026', '2026-13-01', '2026-00-10', '2026-02-29', '2026-04-31', '2026-11-00', 'abc']) {
      expect(tanggalValid(s)).toBe(false);
    }
    expect(uraiTanggal(undefined)).toBeNull();
    expect(uraiTanggal(20261104)).toBeNull();
  });
});

describe('kalender', () => {
  it('kabisat dan jumlah hari', () => {
    expect(kabisat(2024)).toBe(true);
    expect(kabisat(1900)).toBe(false);
    expect(kabisat(2000)).toBe(true);
    expect(hariDalamBulan(2026, 2)).toBe(28);
    expect(hariDalamBulan(2028, 2)).toBe(29);
    expect(hariDalamBulan(2026, 11)).toBe(30);
    expect(hariDalamBulan(2026, 12)).toBe(31);
  });

  it('tambahHari melewati batas bulan, tahun, dan kabisat', () => {
    expect(tambahHari('2026-10-31', 1)).toBe('2026-11-01');
    expect(tambahHari('2026-12-31', 1)).toBe('2027-01-01');
    expect(tambahHari('2027-01-01', -1)).toBe('2026-12-31');
    expect(tambahHari('2028-02-28', 1)).toBe('2028-02-29');
    expect(tambahHari('2026-02-28', 1)).toBe('2026-03-01');
    expect(tambahHari('2026-11-04', -29)).toBe('2026-10-06');
    expect(tambahHari('2026-11-04', 0)).toBe('2026-11-04');
  });

  it('tambahBulan memangkas hari ke akhir bulan tujuan dan melewati Desember ke Januari', () => {
    expect(tambahBulan('2026-01-31', 1)).toBe('2026-02-28');
    expect(tambahBulan('2028-01-31', 1)).toBe('2028-02-29');
    expect(tambahBulan('2026-12-15', 1)).toBe('2027-01-15');
    expect(tambahBulan('2027-01-15', -1)).toBe('2026-12-15');
    expect(tambahBulan('2026-03-31', -1)).toBe('2026-02-28');
    expect(tambahBulan('2026-11-04', 14)).toBe('2028-01-04');
    expect(tambahBulan('2026-01-10', -13)).toBe('2024-12-10');
  });

  it('tambahTahun memangkas 29 Februari pada tahun biasa', () => {
    expect(tambahTahun('2028-02-29', 1)).toBe('2029-02-28');
    expect(tambahTahun('2028-02-29', 4)).toBe('2032-02-29');
    expect(tambahTahun('2026-11-04', -1)).toBe('2025-11-04');
  });

  it('hari dalam pekan: Senin = 0', () => {
    expect(hariPekan('2026-11-02')).toBe(0); // Senin
    expect(hariPekan('2026-11-04')).toBe(2); // Rabu
    expect(hariPekan('2026-11-08')).toBe(6); // Minggu
    expect(awalPekan('2026-11-04')).toBe('2026-11-02');
    expect(akhirPekan('2026-11-04')).toBe('2026-11-08');
    expect(awalPekan('2026-11-02')).toBe('2026-11-02');
    expect(akhirPekan('2026-11-08')).toBe('2026-11-08');
    expect(awalPekan('2027-01-01')).toBe('2026-12-28');
  });

  it('awal dan akhir bulan', () => {
    expect(awalBulan('2026-11-04')).toBe('2026-11-01');
    expect(akhirBulan('2026-11-04')).toBe('2026-11-30');
    expect(akhirBulan('2028-02-10')).toBe('2028-02-29');
  });

  it('bandingkan, selisih, apitkan, diLuarBatas, urutkanRentang', () => {
    expect(bandingkanTanggal('2026-01-01', '2026-01-02')).toBe(-1);
    expect(bandingkanTanggal('2026-01-02', '2026-01-02')).toBe(0);
    expect(bandingkanTanggal('2027-01-01', '2026-12-31')).toBe(1);
    expect(selisihHari('2026-10-06', '2026-11-04')).toBe(29);
    expect(selisihHari('2026-12-31', '2027-01-01')).toBe(1);
    expect(apitkan('2026-11-04', '2026-11-10', '2026-11-30')).toBe('2026-11-10');
    expect(apitkan('2026-12-04', '2026-11-10', '2026-11-30')).toBe('2026-11-30');
    expect(apitkan('2026-11-20', undefined, undefined)).toBe('2026-11-20');
    expect(apitkan('2026-11-20', '', 'bukan-tanggal')).toBe('2026-11-20');
    expect(diLuarBatas('2026-11-09', '2026-11-10')).toBe(true);
    expect(diLuarBatas('2026-11-10', '2026-11-10', '2026-11-10')).toBe(false);
    expect(urutkanRentang('2026-11-04', '2026-10-06')).toEqual({ dari: '2026-10-06', sampai: '2026-11-04' });
  });

  it('susunBulan: pekan dimulai Senin, sel kosong di luar bulan', () => {
    const nov = susunBulan(2026, 11); // 1 Nov 2026 = Minggu
    expect(nov[0]).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(nov[nov.length - 1].filter(Boolean).slice(-1)[0]).toBe('2026-11-30');
    expect(nov.flat().filter(Boolean)).toHaveLength(30);
    expect(nov.every((p) => p.length === 7)).toBe(true);

    const feb = susunBulan(2027, 2); // 1 Feb 2027 = Senin, 28 hari = 4 pekan penuh
    expect(feb).toHaveLength(4);
    expect(feb.flat().every(Boolean)).toBe(true);

    const febKabisat = susunBulan(2028, 2);
    expect(febKabisat.flat().filter(Boolean)).toHaveLength(29);
  });
});

describe('format', () => {
  it('format tunggal', () => {
    expect(formatPendek('2026-11-04')).toBe('4 Nov 2026');
    expect(formatPanjang('2026-11-04')).toBe('4 November 2026');
    expect(formatPanjangDenganHari('2026-11-04')).toBe('Rabu, 4 November 2026');
    expect(formatBulanTahun('2026-11-04')).toBe('November 2026');
    expect(formatPendek('salah')).toBe('');
    expect(formatPanjang('')).toBe('');
  });

  it('format rentang tanpa em dash, tahun awal hanya bila beda tahun', () => {
    expect(formatRentangPendek('2026-10-06', '2026-11-04')).toBe('6 Okt sampai 4 Nov 2026');
    expect(formatRentangPendek('2025-12-28', '2026-01-03')).toBe('28 Des 2025 sampai 3 Jan 2026');
    expect(formatRentangPendek('2026-11-04', '2026-11-04')).toBe('4 Nov 2026');
    expect(formatRentangPanjang('2026-10-06', '2026-11-04')).toBe('6 Oktober sampai 4 November 2026');
    expect(formatRentangPanjang('2025-12-28', '2026-01-03')).toBe('28 Desember 2025 sampai 3 Januari 2026');
    expect(formatRentangPendek('', '2026-11-04')).toBe('');
    expect(formatRentangPendek('2026-10-06', '2026-11-04')).not.toMatch(/[–—]/);
  });
});

describe('pilihan cepat bawaan', () => {
  const hitung = (kunci: string, hariIni: string) => PILIHAN_CEPAT_BAWAAN.find((p) => p.kunci === kunci)!.hitung(hariIni);

  it('memuat lima pilihan berurutan', () => {
    expect(PILIHAN_CEPAT_BAWAAN.map((p) => p.label)).toEqual([
      'Hari ini',
      '7 hari terakhir',
      '30 hari terakhir',
      'Bulan ini',
      'Bulan lalu',
    ]);
  });

  it('menghitung dari 4 November 2026', () => {
    expect(hitung('hari-ini', '2026-11-04')).toEqual({ dari: '2026-11-04', sampai: '2026-11-04' });
    expect(hitung('7-hari', '2026-11-04')).toEqual({ dari: '2026-10-29', sampai: '2026-11-04' });
    expect(hitung('30-hari', '2026-11-04')).toEqual({ dari: '2026-10-06', sampai: '2026-11-04' });
    expect(hitung('bulan-ini', '2026-11-04')).toEqual({ dari: '2026-11-01', sampai: '2026-11-04' });
    expect(hitung('bulan-lalu', '2026-11-04')).toEqual({ dari: '2026-10-01', sampai: '2026-10-31' });
  });

  it('tepi tahun dan kabisat', () => {
    expect(hitung('bulan-lalu', '2027-01-15')).toEqual({ dari: '2026-12-01', sampai: '2026-12-31' });
    expect(hitung('bulan-lalu', '2028-03-31')).toEqual({ dari: '2028-02-01', sampai: '2028-02-29' });
    expect(hitung('7-hari', '2027-01-03')).toEqual({ dari: '2026-12-28', sampai: '2027-01-03' });
    expect(hitung('30-hari', '2028-03-01')).toEqual({ dari: '2028-02-01', sampai: '2028-03-01' });
  });

  it('apitkanRentang menjepit atau menolak bila seluruhnya di luar batas', () => {
    const r = { dari: '2026-10-06', sampai: '2026-11-04' };
    expect(apitkanRentang(r)).toEqual(r);
    expect(apitkanRentang(r, '2026-10-20')).toEqual({ dari: '2026-10-20', sampai: '2026-11-04' });
    expect(apitkanRentang(r, undefined, '2026-10-10')).toEqual({ dari: '2026-10-06', sampai: '2026-10-10' });
    expect(apitkanRentang(r, '2026-11-05')).toBeNull();
    expect(apitkanRentang(r, undefined, '2026-10-05')).toBeNull();
  });
});
