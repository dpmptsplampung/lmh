import { describe, expect, it } from 'vitest';
import { adalahUrlFotoR2, validasiUrlFoto } from './foto-url';

const CONTOH = 'https://satudata.umkm.go.id/storage/bps/foto/ae0f4168-a0d3-45ab-b9aa-534f337428e9__foto_usaha_1__20231014__205705__g.jpg';

describe('validasiUrlFoto', () => {
  it('menerima tautan contoh dan memangkas spasi', () => {
    expect(validasiUrlFoto(CONTOH)).toEqual({ ok: true, url: CONTOH });
    expect(validasiUrlFoto(`  ${CONTOH}  `)).toEqual({ ok: true, url: CONTOH });
  });
  it.each([
    'http://x.id/a.jpg', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'https://user:pw@x.id/a.jpg',
    'https://localhost/a.jpg', 'https://127.0.0.1/a.jpg', 'https://192.168.1.5/a.jpg', 'https://[::1]/a.jpg',
    'https://printer.local/a.jpg', 'https://intranet/a.jpg', 'https://x.id/', '', '   ', 'bukan url',
    `https://x.id/${'a'.repeat(500)}`,
  ])('menolak %s', (v) => {
    expect(validasiUrlFoto(v).ok).toBe(false);
  });
});

describe('adalahUrlFotoR2', () => {
  it('mengenali awalan publik R2 area umkm-photos', () => {
    expect(adalahUrlFotoR2('https://pub.example.org/umkm-photos/a.jpg', 'https://pub.example.org/')).toBe(true);
    expect(adalahUrlFotoR2('https://pub.example.org/lain/a.jpg', 'https://pub.example.org')).toBe(false);
    expect(adalahUrlFotoR2('https://x.id/a.jpg', '')).toBe(false);
  });
});
