import { afterEach, describe, expect, it, vi } from 'vitest';
import { enterTanpaKomposisi, perilakuGulir, sedangMenyusun } from './interaksi';

describe('sedangMenyusun / enterTanpaKomposisi', () => {
  it('Enter biasa lolos', () => {
    expect(enterTanpaKomposisi({ key: 'Enter', nativeEvent: { isComposing: false } })).toBe(true);
  });
  it('Enter saat IME menyusun ditolak', () => {
    expect(enterTanpaKomposisi({ key: 'Enter', nativeEvent: { isComposing: true } })).toBe(false);
  });
  it('cadangan Safari: keyCode 229 dianggap menyusun', () => {
    expect(sedangMenyusun({ key: 'Enter', keyCode: 229, nativeEvent: { isComposing: false } })).toBe(true);
    expect(enterTanpaKomposisi({ key: 'Enter', nativeEvent: { keyCode: 229 } })).toBe(false);
  });
  it('tombol selain Enter tidak lolos', () => {
    expect(enterTanpaKomposisi({ key: 'a' })).toBe(false);
  });
});

describe('perilakuGulir', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('auto saat pengguna meminta gerak dikurangi', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(perilakuGulir()).toBe('auto');
  });
  it('smooth bila tidak', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(perilakuGulir()).toBe('smooth');
  });
});
