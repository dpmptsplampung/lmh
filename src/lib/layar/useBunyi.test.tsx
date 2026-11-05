// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBunyi } from './useBunyi';

const osilator = () => ({ type: '', frequency: { value: 0 }, connect: vi.fn().mockReturnThis(), start: vi.fn(), stop: vi.fn() });
const gain = () => ({ gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn().mockReturnThis() });

let dibuat = 0;
let osilatorDibuat: ReturnType<typeof osilator>[] = [];
class AudioContextPalsu {
  state = 'suspended';
  currentTime = 0;
  destination = {};
  constructor() { dibuat++; }
  resume = vi.fn(async () => { this.state = 'running'; });
  createOscillator = vi.fn(() => { const o = osilator(); osilatorDibuat.push(o); return o; });
  createGain = vi.fn(gain);
}

describe('useBunyi: ding Web Audio tanpa berkas audio, aktif setelah satu klik', () => {
  beforeEach(() => { dibuat = 0; osilatorDibuat = []; });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('peramban tanpa Web Audio: tidak tersedia, ding aman dipanggil', async () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', undefined);
    const { result } = renderHook(() => useBunyi());
    expect(result.current.tersedia).toBe(false);
    expect(() => result.current.ding()).not.toThrow();
  });

  it('sebelum diklik: tersedia tetapi belum aktif, ding diam dan tidak membuat konteks audio', () => {
    vi.stubGlobal('AudioContext', AudioContextPalsu);
    const { result } = renderHook(() => useBunyi());
    expect(result.current.tersedia).toBe(true);
    expect(result.current.aktif).toBe(false);
    act(() => result.current.ding());
    expect(dibuat).toBe(0);
  });

  it('aktifkan() (dari klik) membuat konteks sekali dan menandai aktif; ding membunyikan osilator', async () => {
    vi.stubGlobal('AudioContext', AudioContextPalsu);
    const { result } = renderHook(() => useBunyi());
    await act(async () => { result.current.aktifkan(); });
    expect(result.current.aktif).toBe(true);
    await act(async () => { result.current.aktifkan(); });
    expect(dibuat).toBe(1);
    act(() => result.current.ding());
    expect(osilatorDibuat.length).toBeGreaterThanOrEqual(2);
    for (const o of osilatorDibuat) {
      expect(o.start).toHaveBeenCalled();
      expect(o.stop).toHaveBeenCalled();
    }
  });

  it('galat dari Web Audio tidak merusak layar', async () => {
    vi.stubGlobal('AudioContext', class { constructor() { throw new Error('diblokir'); } });
    const { result } = renderHook(() => useBunyi());
    await act(async () => { result.current.aktifkan(); });
    expect(result.current.aktif).toBe(false);
    expect(() => result.current.ding()).not.toThrow();
  });
});
