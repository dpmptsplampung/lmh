import { describe, it, expect } from 'vitest';
import { formatTanggalId, formatWaktuId, hitungDurasiMenit, slugify } from './format';

describe('rekap format', () => {
  it('formatTanggalId converts ISO date to dd/MM/yyyy', () => {
    expect(formatTanggalId('2026-08-31')).toBe('31/08/2026');
    expect(formatTanggalId('2026-01-05')).toBe('05/01/2026');
  });

  it('formatTanggalId treats date-only input as a calendar date (no timezone shift)', () => {
    // Regression: a +7h shift used to roll 31 Dec into 1 Jan on the UTC boundary.
    expect(formatTanggalId('2026-12-31')).toBe('31/12/2026');
    expect(formatTanggalId('2026-01-01')).toBe('01/01/2026');
  });

  it('formatWaktuId converts ISO datetime to HH:mm in WIB', () => {
    // 2026-08-31T01:05:00Z = 08:05 WIB (UTC+7)
    expect(formatWaktuId('2026-08-31T01:05:00Z')).toBe('08:05');
  });

  it('formatWaktuId returns empty string for null', () => {
    expect(formatWaktuId(null)).toBe('');
  });

  it('hitungDurasiMenit returns null when input is null', () => {
    expect(hitungDurasiMenit(null, '2026-08-31T01:20:00Z')).toBeNull();
    expect(hitungDurasiMenit('2026-08-31T01:05:00Z', null)).toBeNull();
  });

  it('slugify lowercases and collapses non-alphanumeric runs', () => {
    expect(slugify('Layanan Perizinan DPMPTSP Provinsi Lampung')).toBe(
      'layanan-perizinan-dpmptsp-provinsi-lampung',
    );
    expect(slugify('OSS--RBA')).toBe('oss-rba');
    expect(slugify('  Data & UMKM ')).toBe('data-umkm');
  });

  it('hitungDurasiMenit returns minutes difference', () => {
    expect(hitungDurasiMenit('2026-08-31T01:05:00Z', '2026-08-31T01:20:00Z')).toBe(15);
  });
});
