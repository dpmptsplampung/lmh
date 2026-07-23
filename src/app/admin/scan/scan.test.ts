import { describe, it, expect } from 'vitest';

function getLocalDateString(d = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

describe('Scan QR Check-In Helper', () => {
  it('formats local date YYYY-MM-DD correctly without UTC day shift', () => {
    const d = new Date(2026, 6, 23, 6, 30); // 23 July 2026 06:30 local
    const formatted = getLocalDateString(d);
    expect(formatted).toBe('2026-07-23');
  });
});
