import { describe, expect, it } from 'vitest';
import { PATH_REGISTRASI, tabDariParam, urlRegistrasi } from './registrasi-url';

describe('tabDariParam', () => {
  it('scan -> scan; apa pun lainnya (kosong, tak dikenal, walkin) -> walkin', () => {
    expect(tabDariParam('scan')).toBe('scan');
    expect(tabDariParam('walkin')).toBe('walkin');
    expect(tabDariParam(null)).toBe('walkin');
    expect(tabDariParam(undefined)).toBe('walkin');
    expect(tabDariParam('ngawur')).toBe('walkin');
    expect(tabDariParam(['scan', 'walkin'])).toBe('scan');
  });
});

describe('urlRegistrasi', () => {
  it('membangun URL tab tanpa query lain', () => {
    expect(urlRegistrasi('walkin')).toBe(`${PATH_REGISTRASI}?tab=walkin`);
    expect(urlRegistrasi('scan')).toBe(`${PATH_REGISTRASI}?tab=scan`);
  });

  it('meneruskan query lain (objek atau URLSearchParams), nilai berulang dipertahankan, parameter tab lama diganti', () => {
    expect(urlRegistrasi('scan', { token: 'abc', tab: 'walkin', x: ['1', '2'], kosong: undefined })).toBe(
      `${PATH_REGISTRASI}?tab=scan&token=abc&x=1&x=2`,
    );
    expect(urlRegistrasi('walkin', new URLSearchParams('tab=scan&q=a%20b'))).toBe(`${PATH_REGISTRASI}?tab=walkin&q=a+b`);
  });
});
