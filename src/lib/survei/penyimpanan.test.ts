// Uji draf sesi wizard Pesan Perilaku (Task 7): sessionStorage (jsdom), semua akses dibungkus try/catch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buatState } from './wizard';
import { hapusDraf, muatDraf, simpanDraf } from './penyimpanan';

const TOKEN = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const KUNCI = 'lmh:survei:0123456789abcdef';

describe('draf sesi wizard (sessionStorage)', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('simpan lalu muat mengembalikan state identik, dengan kunci lmh:survei:<16 karakter pertama token>', () => {
    const state = buatState({ p1: 6, p2: 1, p3: 3, p4: 5, u1: 4, u2: 1 }, 2);
    simpanDraf(TOKEN, state);
    expect(sessionStorage.getItem(KUNCI)).not.toBeNull();
    expect(sessionStorage.length).toBe(1);
    expect(muatDraf(TOKEN)).toEqual(state);
  });

  it('draf terpisah per token (16 karakter pertama berbeda) dan token yang sama 16 karakter pertamanya berbagi kunci', () => {
    const a = buatState({ p1: 2 }, 0);
    const b = buatState({ p1: 5 }, 0);
    simpanDraf(TOKEN, a);
    simpanDraf('ffffffffffffffff' + TOKEN.slice(16), b);
    expect(muatDraf(TOKEN)).toEqual(a);
    expect(muatDraf('ffffffffffffffff' + TOKEN.slice(16))).toEqual(b);
  });

  it('tanpa draf -> null', () => {
    expect(muatDraf(TOKEN)).toBeNull();
  });

  it('hapusDraf menghapus draf', () => {
    simpanDraf(TOKEN, buatState({ p1: 3 }, 0));
    hapusDraf(TOKEN);
    expect(sessionStorage.getItem(KUNCI)).toBeNull();
    expect(muatDraf(TOKEN)).toBeNull();
  });

  describe('draf rusak -> null (tanpa melempar)', () => {
    const rusak: [string, string][] = [
      ['JSON rusak', '{bukan json'],
      ['bukan objek (angka)', '42'],
      ['null', 'null'],
      ['array', '[]'],
      ['tanpa jawaban', JSON.stringify({ indeks: 0 })],
      ['tanpa indeks', JSON.stringify({ jawaban: {} })],
      ['indeks bukan bilangan bulat', JSON.stringify({ indeks: 1.5, jawaban: {} })],
      ['indeks negatif', JSON.stringify({ indeks: -1, jawaban: {} })],
      ['indeks di luar langkah (5)', JSON.stringify({ indeks: 5, jawaban: {} })],
      ['indeks string', JSON.stringify({ indeks: '1', jawaban: {} })],
      ['jawaban array', JSON.stringify({ indeks: 0, jawaban: [1, 2] })],
      ['SPAK 0', JSON.stringify({ indeks: 0, jawaban: { p1: 0 } })],
      ['SPAK 7', JSON.stringify({ indeks: 0, jawaban: { p1: 7 } })],
      ['SPAK 3.5', JSON.stringify({ indeks: 0, jawaban: { p1: 3.5 } })],
      ['SKM 5', JSON.stringify({ indeks: 2, jawaban: { u1: 5 } })],
      ['nilai string', JSON.stringify({ indeks: 0, jawaban: { p1: '3' } })],
      ['nilai null', JSON.stringify({ indeks: 0, jawaban: { p1: null } })],
      ['kunci asing', JSON.stringify({ indeks: 0, jawaban: { p1: 3, x9: 2 } })],
    ];

    it.each(rusak)('%s', (_nama, isi) => {
      sessionStorage.setItem(KUNCI, isi);
      expect(() => muatDraf(TOKEN)).not.toThrow();
      expect(muatDraf(TOKEN)).toBeNull();
    });
  });

  it('SPAK 6 dan SKM 4 (batas atas) lolos validasi rentang', () => {
    sessionStorage.setItem(KUNCI, JSON.stringify({ indeks: 2, jawaban: { p1: 6, u1: 4, u11: 1 } }));
    expect(muatDraf(TOKEN)).toEqual({ indeks: 2, jawaban: { p1: 6, u1: 4, u11: 1 } });
  });

  describe('sessionStorage melempar (mode privat, kuota penuh, akses diblokir) -> tidak melempar ke pemanggil', () => {
    it('simpanDraf', () => {
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
      expect(() => simpanDraf(TOKEN, buatState({ p1: 3 }, 0))).not.toThrow();
      expect(spy).toHaveBeenCalled();
    });

    it('muatDraf -> null', () => {
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
      expect(() => muatDraf(TOKEN)).not.toThrow();
      expect(muatDraf(TOKEN)).toBeNull();
      expect(spy).toHaveBeenCalled();
    });

    it('hapusDraf', () => {
      const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('SecurityError'); });
      expect(() => hapusDraf(TOKEN)).not.toThrow();
      expect(spy).toHaveBeenCalled();
    });
  });
});
