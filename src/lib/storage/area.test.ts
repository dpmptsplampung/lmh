import { describe, expect, it } from 'vitest';
import { adalahArea, cocokMagicBytes, kunciObjek } from './area';

describe('area', () => {
  it('kunciObjek menggabungkan area dan path', () => {
    expect(kunciObjek('umkm-photos', 'a.jpg')).toBe('umkm-photos/a.jpg');
    expect(kunciObjek('absensi-foto', '2026-11-02/x_1.jpg')).toBe('absensi-foto/2026-11-02/x_1.jpg');
  });
  it.each(['../x', '/x', 'a\\b', 'a\u0000b', '', 'a//b', 'a/./b', 'a/../b', 'x'.repeat(301)])('menolak path %j', (p) => {
    expect(() => kunciObjek('absensi-foto', p)).toThrow();
  });
  it('cocokMagicBytes', () => {
    expect(cocokMagicBytes('image/jpeg', Uint8Array.of(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(cocokMagicBytes('image/jpeg', new TextEncoder().encode('<html>'))).toBe(false);
    expect(cocokMagicBytes('image/png', Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0))).toBe(true);
    expect(cocokMagicBytes('image/webp', new TextEncoder().encode('RIFF\0\0\0\0WEBP'))).toBe(true);
    expect(cocokMagicBytes('application/pdf', new TextEncoder().encode('%PDF-1.7'))).toBe(true);
    expect(cocokMagicBytes('text/html', Uint8Array.of(1, 2, 3))).toBe(false);
  });
  it('adalahArea menolak nama tak dikenal dan properti prototipe', () => {
    expect(adalahArea('absensi-foto')).toBe(true);
    expect(adalahArea('toString')).toBe(false);
    expect(adalahArea(5)).toBe(false);
  });
});
