// @vitest-environment jsdom
// Kontrak useStatusLayanan (tugas 6.3): muat saat percakapan aktif, segarkan tiap 60 dtk, diam selama tab tersembunyi,
// satu muat saat tab terlihat lagi; status milik Layanan lain tidak dipakai.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const data = vi.hoisted(() => ({ ambil: vi.fn() }));
vi.mock('@/lib/data/chat-pengunjung', async (asli) => ({
  ...(await asli<typeof import('@/lib/data/chat-pengunjung')>()),
  ambilStatusLayananChat: data.ambil,
}));

import { STATUS_SEGAR_MS, useStatusLayanan } from './useStatusLayanan';

const L = '11111111-1111-4111-8111-111111111111';
const L2 = '22222222-2222-4222-8222-222222222222';
const TUTUP = { buka: false, tanggal: '2026-11-13', liburKeterangan: null, hariTanpaLayanan: true, bukaBerikutnya: null, sumber: 'jadwal' };

let tersembunyi = false;
beforeEach(() => {
  vi.useFakeTimers();
  data.ambil.mockReset();
  data.ambil.mockResolvedValue({ data: TUTUP, error: null });
  tersembunyi = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => tersembunyi });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const tunggu = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('useStatusLayanan', () => {
  it('tidak memuat bila percakapan tidak aktif atau id Layanan bukan UUID', async () => {
    renderHook(() => useStatusLayanan({ aktif: false, layananId: L }));
    renderHook(() => useStatusLayanan({ aktif: true, layananId: 'bukan-uuid' }));
    await tunggu(STATUS_SEGAR_MS * 2);
    expect(data.ambil).not.toHaveBeenCalled();
  });

  it('memuat langsung lalu tiap 60 dtk; status tutup -> tutup dan tutupRef', async () => {
    const { result } = renderHook(() => useStatusLayanan({ aktif: true, layananId: L }));
    await tunggu();
    expect(data.ambil).toHaveBeenCalledTimes(1);
    expect(data.ambil).toHaveBeenCalledWith(L);
    expect(result.current.status).toEqual(TUTUP);
    expect(result.current.tutup).toBe(true);
    expect(result.current.tutupRef.current).toBe(true);
    await tunggu(STATUS_SEGAR_MS);
    expect(data.ambil).toHaveBeenCalledTimes(2);
  });

  it('tab tersembunyi: tidak ada permintaan; terlihat lagi: satu permintaan', async () => {
    renderHook(() => useStatusLayanan({ aktif: true, layananId: L }));
    await tunggu();
    tersembunyi = true;
    await tunggu(STATUS_SEGAR_MS * 3);
    expect(data.ambil).toHaveBeenCalledTimes(1);
    tersembunyi = false;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(data.ambil).toHaveBeenCalledTimes(2);
  });

  it('galat / tanpa status: tidak ada spanduk (status null, tutup false)', async () => {
    data.ambil.mockResolvedValue({ data: null, error: { jenis: 'http', pesan: '', asli: null } });
    const { result } = renderHook(() => useStatusLayanan({ aktif: true, layananId: L }));
    await tunggu();
    expect(result.current.status).toBeNull();
    expect(result.current.tutup).toBe(false);
  });

  it('pindah Layanan: status Layanan sebelumnya tidak dipakai; interval lama berhenti', async () => {
    const { result, rerender } = renderHook((p: { layananId: string }) => useStatusLayanan({ aktif: true, layananId: p.layananId }), {
      initialProps: { layananId: L },
    });
    await tunggu();
    expect(result.current.tutup).toBe(true);
    data.ambil.mockReturnValue(new Promise(() => undefined)); // Layanan baru belum menjawab
    rerender({ layananId: L2 });
    expect(result.current.status).toBeNull();
    expect(data.ambil).toHaveBeenLastCalledWith(L2);
    await tunggu(STATUS_SEGAR_MS);
    expect(data.ambil.mock.calls.filter(([id]) => id === L)).toHaveLength(1);
  });
});
