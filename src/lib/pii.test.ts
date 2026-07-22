// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { redactPii } from './pii';

describe('redactPii', () => {
  it('masks email addresses', () => {
    expect(redactPii('hubungi saya di budi.santoso+1@gmail.com ya')).toBe(
      'hubungi saya di [email] ya',
    );
  });

  it('masks multiple emails', () => {
    expect(redactPii('a@b.co atau c-d_e@sub.domain.go.id')).toBe(
      '[email] atau [email]',
    );
  });

  it('masks 08xx mobile numbers', () => {
    expect(redactPii('nomor saya 081234567890')).toBe('nomor saya [telepon]');
    expect(redactPii('0812 3456')).toBe('0812 3456');
  });

  it('masks +62 and 62 mobile numbers', () => {
    expect(redactPii('wa: +6281234567890')).toBe('wa: [telepon]');
    expect(redactPii('wa 6281312345678')).toBe('wa [telepon]');
  });

  it('does not mask short digit runs that are not phone numbers', () => {
    expect(redactPii('kode 123456')).toBe('kode 123456');
    expect(redactPii('tahun 2024')).toBe('tahun 2024');
  });

  it('masks 16-digit NIK', () => {
    expect(redactPii('NIK saya 1871051234560001')).toBe('NIK saya [nik]');
  });

  it('does not mask 15- or 17-digit runs as NIK', () => {
    expect(redactPii('123456789012345')).toBe('123456789012345');
    expect(redactPii('12345678901234567')).toBe('12345678901234567');
  });

  it('masks mixed PII in one sentence', () => {
    const out = redactPii(
      'Saya Budi, NIK 1871051234560001, email budi@x.id, hp 081298765432',
    );
    expect(out).toBe('Saya Budi, NIK [nik], email [email], hp [telepon]');
  });

  it('returns plain text unchanged', () => {
    expect(redactPii('Apa syarat membuat NIB?')).toBe('Apa syarat membuat NIB?');
  });
});
