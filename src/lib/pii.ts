const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Indonesian mobile numbers: 08xx (9-13 digits total), +628xx, 628xx.
const PHONE_RE = /(?<!\d)(?:\+62|62|0)8\d{7,11}(?!\d)/g;
// NIK: exactly 16 digits, not part of a longer digit run.
const NIK_RE = /(?<!\d)\d{16}(?!\d)/g;

export function redactPii(text: string): string {
  return text
    .replace(EMAIL_RE, '[email]')
    .replace(PHONE_RE, '[telepon]')
    .replace(NIK_RE, '[nik]');
}
