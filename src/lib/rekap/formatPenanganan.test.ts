import { describe, it, expect } from 'vitest';
import {
  awalHariBerikutnyaWIB,
  awalHariWIB,
  formatMenit,
  formatPersen,
  hariWIB,
  labelHasilTahap,
  labelSaluran,
  labelStatusTiket,
  selisihMenit,
} from './format';
import { jumlahHariRentang, penangananExportQuerySchema, penangananQuerySchema, performaQuerySchema } from './schemas';

describe('batas hari WIB', () => {
  it('23:59 WIB masih hari itu, 00:00 WIB hari berikutnya', () => {
    expect(hariWIB('2026-10-12T16:59:59Z')).toBe('2026-10-12');
    expect(hariWIB('2026-10-12T17:00:00Z')).toBe('2026-10-13');
    expect(hariWIB('2026-12-31T17:00:00Z')).toBe('2027-01-01');
  });

  it('awal hari dan awal hari berikutnya sebagai ISO UTC', () => {
    expect(awalHariWIB('2026-10-13')).toBe('2026-10-12T17:00:00.000Z');
    expect(awalHariBerikutnyaWIB('2026-10-13')).toBe('2026-10-13T17:00:00.000Z');
    expect(awalHariBerikutnyaWIB('2026-12-31')).toBe('2026-12-31T17:00:00.000Z');
  });
});

describe('label status baru', () => {
  it('status tiket dikembalikan/dialihkan berlabel; status asing apa adanya', () => {
    expect(labelStatusTiket('dikembalikan')).toBe('Dikembalikan ke Front Office');
    expect(labelStatusTiket('dialihkan')).toBe('Dialihkan ke Layanan Lain');
    expect(labelStatusTiket('batal')).toBe('Dibatalkan');
    expect(labelStatusTiket('tak-dikenal')).toBe('tak-dikenal');
  });

  it('hasil tahap: hasil, alasan batal, atau belum ditutup', () => {
    expect(labelHasilTahap({ status: 'selesai', hasil: 'dieskalasi', batal_karena: null })).toBe('Dieskalasi ke layanan');
    expect(labelHasilTahap({ status: 'selesai', hasil: 'dikembalikan', batal_karena: null })).toBe('Dikembalikan ke Front Office');
    expect(labelHasilTahap({ status: 'batal', hasil: null, batal_karena: 'dialihkan' })).toBe('Dibatalkan: Dialihkan ke layanan lain');
    expect(labelHasilTahap({ status: 'batal', hasil: null, batal_karena: null })).toBe('Dibatalkan');
    expect(labelHasilTahap({ status: 'berjalan', hasil: null, batal_karena: null })).toBe('Belum ditutup');
  });

  it('saluran', () => {
    expect(labelSaluran('qr')).toBe('Reservasi (QR)');
    expect(labelSaluran('x')).toBe('x');
  });
});

describe('angka', () => {
  it('formatPersen: null/NaN -> em dash, bukan 0%', () => {
    expect(formatPersen(null)).toBe('—');
    expect(formatPersen(NaN)).toBe('—');
    expect(formatPersen(0)).toBe('0%');
    expect(formatPersen(0.25)).toBe('25%');
  });

  it('formatMenit dan selisihMenit', () => {
    expect(formatMenit(null)).toBe('—');
    expect(formatMenit(12.5)).toContain('mnt');
    expect(selisihMenit('2026-10-12T02:00:00Z', '2026-10-12T02:00:30Z')).toBe(0.5);
    expect(selisihMenit('2026-10-12T02:10:00Z', '2026-10-12T02:00:00Z')).toBe(0); // tidak negatif
    expect(selisihMenit(null, 'x')).toBeNull();
    expect(selisihMenit('bukan-tanggal', '2026-10-12T02:00:00Z')).toBeNull();
  });
});

describe('skema query penanganan/performa', () => {
  it('rentang terbalik atau > 366 hari ditolak; default peran fo', () => {
    expect(penangananQuerySchema.safeParse({ dari: '2026-10-13', sampai: '2026-10-12' }).success).toBe(false);
    expect(penangananQuerySchema.safeParse({ dari: '2025-01-01', sampai: '2026-10-12' }).success).toBe(false);
    const ok = penangananQuerySchema.safeParse({ dari: '2026-10-01', sampai: '2026-10-12' });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data).toMatchObject({ peran: 'fo', page: 0, page_size: 25 });
  });

  it('peran/uuid tidak valid ditolak; ekspor dan performa ketat (key asing ditolak)', () => {
    expect(penangananQuerySchema.safeParse({ peran: 'admin' }).success).toBe(false);
    expect(penangananQuerySchema.safeParse({ petugas_id: 'bukan-uuid' }).success).toBe(false);
    expect(penangananExportQuerySchema.safeParse({ asing: '1' }).success).toBe(false);
    expect(performaQuerySchema.safeParse({ asing: '1' }).success).toBe(false);
    expect(performaQuerySchema.safeParse({ dari: '2026-10-01', sampai: '2026-10-12' }).success).toBe(true);
  });

  it('jumlahHariRentang inklusif', () => {
    expect(jumlahHariRentang('2026-10-12', '2026-10-12')).toBe(1);
    expect(jumlahHariRentang('2026-10-01', '2026-10-31')).toBe(31);
  });
});
