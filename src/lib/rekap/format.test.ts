import { describe, it, expect } from 'vitest';
import { formatTanggalId, formatWaktuId, hitungDurasiMenit } from './format';

describe('rekap format', () => {
  it('formatTanggalId converts ISO date to dd/MM/yyyy', () => {
    expect(formatTanggalId('2026-08-31')).toBe('31/08/2026');
    expect(formatTanggalId('2026-01-05')).toBe('05/01/2026');
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

  it('hitungDurasiMenit returns minutes difference', () => {
    expect(hitungDurasiMenit('2026-08-31T01:05:00Z', '2026-08-31T01:20:00Z')).toBe(15);
  });
});
