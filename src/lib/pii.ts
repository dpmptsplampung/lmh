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

const INJECTION_PATTERNS = [
  /ignore\s+(previous|all)\s+instructions/i,
  /abaikan\s+(semua|instruksi|aturan)/i,
  /forget\s+(your\s+)?rules/i,
  /lupakan\s+(semua\s+)?aturan/i,
  /reveal\s+(system\s+)?prompt/i,
  /tunjukkan\s+(system\s+)?prompt/i,
  /tampilkan\s+prompt/i,
  /jailbreak/i,
  /system\s+prompt\s+extraction/i,
];

export function detectPromptInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

