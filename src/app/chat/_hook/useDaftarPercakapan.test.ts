// @vitest-environment jsdom
// Kontrak useDaftarPercakapan (tugas 6.3): menunggu `aktif`, hasil muat PERTAMA (atau null bila gagal) diteruskan sekali
// ke onPertama, muat ulang tidak memicunya lagi, dan penanda dibaca dibaca dari perangkat.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const data = vi.hoisted(() => ({ muat: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('@/lib/data/chat-pengunjung', async (asli) => ({
  ...(await asli<typeof import('@/lib/data/chat-pengunjung')>()),
  muatDaftarPercakapan: data.muat,
}));

import type { PercakapanRingkas } from '@/lib/chat/percakapan';
import { useDaftarPercakapan } from './useDaftarPercakapan';

const L = '11111111-1111-4111-8111-111111111111';
const item = { layananId: L, layananNama: 'Bank', sesiTerakhirId: 's1', sesiTerbukaId: 's1' } as PercakapanRingkas;

beforeEach(() => {
  data.muat.mockReset();
  data.muat.mockResolvedValue({ data: [item], error: null });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});
// Daftar Layanan stabil (di halaman: state useReferensiChat); larik baru tiap render memicu muat ulang.
const TANPA_LAYANAN: never[] = [];

describe('useDaftarPercakapan', () => {
  it('tidak memuat sebelum aktif; setelah aktif memuat dan memanggil onPertama sekali', async () => {
    const onPertama = vi.fn();
    localStorage.setItem(`lmh_chat_dibaca_${L}`, '2026-11-01T00:00:00Z');
    const { result, rerender } = renderHook((p: { aktif: boolean }) =>
      useDaftarPercakapan({ aktif: p.aktif, pengunjungId: 'p1', layanan: TANPA_LAYANAN, onPertama }), { initialProps: { aktif: false } });
    expect(data.muat).not.toHaveBeenCalled();
    rerender({ aktif: true });
    await waitFor(() => expect(result.current.siap).toBe(true));
    expect(result.current.daftar).toEqual([item]);
    expect(result.current.dibaca).toEqual({ [L]: '2026-11-01T00:00:00Z' });
    expect(onPertama).toHaveBeenCalledExactlyOnceWith([item]);
    expect(data.muat).toHaveBeenCalledWith({}, { pengunjungId: 'p1', layanan: [] });

    act(() => result.current.muatUlang());
    await waitFor(() => expect(data.muat).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.memuat).toBe(false));
    expect(onPertama).toHaveBeenCalledTimes(1);
  });

  it('gagal: galat + siap, onPertama(null); Coba lagi yang berhasil mengisi daftar tanpa onPertama lagi', async () => {
    data.muat.mockResolvedValueOnce({ data: null, error: { jenis: 'database', pesan: 'x', asli: null } });
    const onPertama = vi.fn();
    const { result } = renderHook(() => useDaftarPercakapan({ aktif: true, pengunjungId: 'p1', layanan: TANPA_LAYANAN, onPertama }));
    await waitFor(() => expect(result.current.galat).toBe(true));
    expect(result.current.siap).toBe(true);
    expect(onPertama).toHaveBeenCalledExactlyOnceWith(null);
    act(() => result.current.muatUlang());
    await waitFor(() => expect(result.current.daftar).toEqual([item]));
    expect(result.current.galat).toBe(false);
    expect(onPertama).toHaveBeenCalledTimes(1);
  });

  it('memakai onPertama terbaru tanpa memuat ulang saat fungsinya berganti', async () => {
    let lepas!: (v: unknown) => void;
    data.muat.mockReturnValueOnce(new Promise((r) => (lepas = r)));
    const lama = vi.fn();
    const baru = vi.fn();
    const { rerender } = renderHook((p: { f: (i: PercakapanRingkas[] | null) => void }) =>
      useDaftarPercakapan({ aktif: true, pengunjungId: 'p1', layanan: TANPA_LAYANAN, onPertama: p.f }), { initialProps: { f: lama } });
    rerender({ f: baru });
    await act(async () => lepas({ data: [item], error: null }));
    expect(data.muat).toHaveBeenCalledTimes(1);
    expect(lama).not.toHaveBeenCalled();
    expect(baru).toHaveBeenCalledExactlyOnceWith([item]);
  });
});
