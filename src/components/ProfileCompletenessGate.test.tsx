// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KATEGORI_PENGUNJUNG } from '@/lib/constants';
import { isPhoneValid } from './ProfileCompletenessGate';

describe('ProfileCompletenessGate kategori options & field rules', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/ProfileCompletenessGate.tsx'),
    'utf8',
  );

  it('imports KATEGORI_PENGUNJUNG and does not hardcode akademisi or lowercase values', () => {
    expect(source).toMatch(/KATEGORI_PENGUNJUNG/);
    expect(source).not.toMatch(/value=["']akademisi["']/);
    expect(source).not.toMatch(/value=["']umum["']/);
    expect(source).not.toMatch(/value=["']umkm["']/);
    expect(source).not.toMatch(/value=["']investor["']/);
    expect(source).not.toMatch(/value=["']instansi["']/);
  });

  it('renders options only from the typed constant keys', () => {
    for (const key of Object.keys(KATEGORI_PENGUNJUNG)) {
      expect(source).toMatch(new RegExp(`Object\\.(?:entries|keys)\\(KATEGORI_PENGUNJUNG\\)`));
      expect(key).toMatch(/^(Umum|UMKM|Investor|Instansi)$/);
    }
  });

  it('validates phone numbers with isPhoneValid correctly (min 10 digits & valid prefix)', () => {
    // Valid Indonesian mobile numbers (>= 10 digits starting with 08, 628, +628)
    expect(isPhoneValid('08123456789')).toBe(true);
    expect(isPhoneValid('0812345678')).toBe(true); // 10 digits
    expect(isPhoneValid('+6281234567890')).toBe(true);
    expect(isPhoneValid('6285712345678')).toBe(true);
    expect(isPhoneValid('0812-3456-7890')).toBe(true); // formatted with hyphens

    // Invalid phone numbers
    expect(isPhoneValid('081234567')).toBe(false); // only 9 digits (too short)
    expect(isPhoneValid('1234567890')).toBe(false); // invalid prefix
    expect(isPhoneValid('abc08123456789')).toBe(false); // letters
    expect(isPhoneValid('0217654321')).toBe(false); // 021 landline (not mobile 08...)
  });

  it('contains phone field, name warning, and confirmation popup elements', () => {
    expect(source).toMatch(/Nomor HP \/ WhatsApp/);
    expect(source).toMatch(/isPhoneValid/);
    expect(source).toMatch(/Peringatan: Mohon isi nama lengkap Anda/);
    expect(source).toMatch(/Konfirmasi Data Anda/);
    expect(source).toMatch(/Ya, Sudah Benar/);
    expect(source).toMatch(/Periksa Kembali/);
  });
});
