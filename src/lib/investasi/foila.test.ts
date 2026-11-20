import { describe, expect, it } from 'vitest';
import { slugFoila, validasiUrlFoila } from './foila';

describe('tautan FOILA', () => {
  it('menerima hanya sumber resmi sesuai CHECK SQL', () => {
    expect(validasiUrlFoila('https://invest.lampungprov.go.id/proyek/pelabuhan/')).toBeInstanceOf(URL);
    expect(slugFoila('https://invest.lampungprov.go.id/proyek/pelabuhan/?a=1')).toBe('pelabuhan');
  });
  it.each([
    'http://invest.lampungprov.go.id/x', 'https://invest.lampungprov.go.id.evil.test/x',
    'https://user@invest.lampungprov.go.id/x', 'https://invest.lampungprov.go.id:443/x',
    'https://invest.lampungprov.go.id:8080/x', 'https://INVEST.lampungprov.go.id/x',
    'https://invest.lampungprov.go.id', 'https://invest.lampungprov.go.id/x y',
    'https://invest.lampungprov.go.id/\\evil', 'https://invest.lampungprov.go.id/\nx',
  ])('menolak %s', (url) => expect(validasiUrlFoila(url)).toBeNull());
});
