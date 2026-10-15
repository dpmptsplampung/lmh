import { describe, expect, it, vi } from 'vitest';
import { isChunkError, pulihkanDariErrorChunk, RELOAD_KEY } from './chunk-recovery';

function fakeStorage(awal: Record<string, string> = {}) {
  const data = { ...awal };
  return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
}

describe('isChunkError', () => {
  it.each([
    'Error: Module 71645 was instantiated because it was required from module 56420, but the module factory is not available.',
    'ChunkLoadError: Loading chunk 123 failed.',
    'Loading chunk app/page failed',
    'Failed to fetch dynamically imported module: https://x/y.js',
  ])('mengenali %s', (pesan) => expect(isChunkError(pesan)).toBe(true));

  it('mengenali Error dan menolak error biasa', () => {
    expect(isChunkError(new Error('module factory is not available'))).toBe(true);
    expect(isChunkError(new Error('Network request failed'))).toBe(false);
    expect(isChunkError(undefined)).toBe(false);
  });
});

describe('pulihkanDariErrorChunk', () => {
  it('reload satu kali lalu menahan loop dalam jeda', () => {
    const reload = vi.fn();
    const storage = fakeStorage();
    expect(pulihkanDariErrorChunk({ now: 1000, storage, reload, isianAktif: false })).toBe('reload');
    expect(storage.getItem(RELOAD_KEY)).toBe('1000');
    expect(pulihkanDariErrorChunk({ now: 5000, storage, reload, isianAktif: false })).toBe('banner');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(pulihkanDariErrorChunk({ now: 70_000, storage, reload, isianAktif: false })).toBe('reload');
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('tidak reload otomatis saat ada isian aktif/terisi (banner saja)', () => {
    const reload = vi.fn();
    expect(pulihkanDariErrorChunk({ now: 1000, storage: fakeStorage(), reload, isianAktif: true })).toBe('banner');
    expect(reload).not.toHaveBeenCalled();
  });
});
