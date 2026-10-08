import { describe, expect, it } from 'vitest';
import {
  STAFF_EMAIL_DOMAIN,
  isSyntheticEmail,
  isValidUsername,
  normalizeNoHp,
  resolveLoginEmail,
  usernameToEmail,
} from './login';

describe('login username', () => {
  it('username -> email sintetis (huruf kecil, trim)', () => {
    expect(resolveLoginEmail('  Helpdesk-OSS ')).toBe(`helpdesk-oss@${STAFF_EMAIL_DOMAIN}`);
    expect(usernameToEmail('Bank-Lampung')).toBe(`bank-lampung@${STAFF_EMAIL_DOMAIN}`);
  });
  it('input ber-@ dipakai apa adanya (transisi / pengunjung)', () => {
    expect(resolveLoginEmail(' Orang@Contoh.com ')).toBe('orang@contoh.com');
  });
  it('validasi username', () => {
    expect(isValidUsername('helpdesk-oss')).toBe(true);
    for (const bad of ['ab', 'Admin', 'admin', '-abc', 'a b c', 'a_b_c', 'x'.repeat(33), 'a@b.com']) {
      expect(isValidUsername(bad), bad).toBe(false);
    }
  });
  it('isSyntheticEmail', () => {
    expect(isSyntheticEmail(`x-y@${STAFF_EMAIL_DOMAIN}`)).toBe(true);
    expect(isSyntheticEmail('x@gmail.com')).toBe(false);
    expect(isSyntheticEmail(null)).toBe(false);
  });
  it('normalizeNoHp', () => {
    expect(normalizeNoHp('0812-3456 7890')).toBe('+6281234567890');
    expect(normalizeNoHp('6281234567890')).toBe('+6281234567890');
    expect(normalizeNoHp('+62 812 3456 7890')).toBe('+6281234567890');
    expect(normalizeNoHp('abc')).toBeNull();
    expect(normalizeNoHp('0812')).toBeNull();
  });
});
