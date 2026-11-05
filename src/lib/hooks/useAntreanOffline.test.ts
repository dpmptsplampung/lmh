// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({
  uid: 'fo-1' as string | null,
  pending: [] as { owner_user_id: string }[],
  getSession: vi.fn(),
  getPending: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { getSession: m.getSession } }) }));
vi.mock('@/lib/offline/queue', () => ({ getPending: m.getPending }));

import { EVENT_REPLAY_OFFLINE, siarkanReplayOffline, teksAntreanOffline, useAntreanOffline } from './useAntreanOffline';

beforeEach(() => {
  m.uid = 'fo-1';
  m.pending = [];
  m.getSession.mockImplementation(async () => ({ data: { session: m.uid ? { user: { id: m.uid } } : null } }));
  m.getPending.mockImplementation(async (id: string) => m.pending.filter((p) => p.owner_user_id === id));
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('teksAntreanOffline', () => {
  it('kosong bila 0; satu atau banyak', () => {
    expect(teksAntreanOffline(0)).toBeNull();
    expect(teksAntreanOffline(1)).toBe('1 pendaftaran menunggu dikirim');
    expect(teksAntreanOffline(2)).toBe('2 pendaftaran menunggu dikirim');
  });
});

describe('useAntreanOffline', () => {
  it('menghitung hanya item milik akun yang masuk', async () => {
    m.pending = [{ owner_user_id: 'fo-1' }, { owner_user_id: 'fo-1' }, { owner_user_id: 'lain' }];
    const { result } = renderHook(() => useAntreanOffline());
    await waitFor(() => expect(result.current.jumlah).toBe(2));
    expect(m.getPending).toHaveBeenCalledWith('fo-1');
  });

  it('tanpa sesi: nol dan antrean tidak dibaca', async () => {
    m.uid = null;
    m.pending = [{ owner_user_id: 'fo-1' }];
    const { result } = renderHook(() => useAntreanOffline());
    await waitFor(() => expect(m.getSession).toHaveBeenCalled());
    expect(result.current.jumlah).toBe(0);
    expect(m.getPending).not.toHaveBeenCalled();
  });

  it('tidak aktif: tidak membaca apa pun', () => {
    renderHook(() => useAntreanOffline(false));
    expect(m.getSession).not.toHaveBeenCalled();
  });

  it('galat penyimpanan tidak melempar', async () => {
    m.getPending.mockRejectedValue(new Error('idb'));
    const { result } = renderHook(() => useAntreanOffline());
    await waitFor(() => expect(m.getPending).toHaveBeenCalled());
    expect(result.current).toEqual({ jumlah: 0, terkirim: false });
  });

  it('sesudah replay mengirim semuanya: Terkirim sesaat, lalu hilang', async () => {
    m.pending = [{ owner_user_id: 'fo-1' }];
    const { result } = renderHook(() => useAntreanOffline());
    await waitFor(() => expect(result.current.jumlah).toBe(1));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    m.pending = [];
    await act(async () => {
      siarkanReplayOffline({ synced: 1, failed: 0 });
    });
    await vi.waitFor(() => expect(result.current.terkirim).toBe(true));
    expect(result.current.jumlah).toBe(0);
    await act(async () => {
      vi.advanceTimersByTime(6_100);
    });
    expect(result.current.terkirim).toBe(false);
  });

  it('replay yang masih menyisakan item tidak menampilkan Terkirim', async () => {
    m.pending = [{ owner_user_id: 'fo-1' }, { owner_user_id: 'fo-1' }];
    const { result } = renderHook(() => useAntreanOffline());
    await waitFor(() => expect(result.current.jumlah).toBe(2));
    m.pending = [{ owner_user_id: 'fo-1' }];
    await act(async () => {
      window.dispatchEvent(new CustomEvent(EVENT_REPLAY_OFFLINE, { detail: { synced: 1, failed: 1 } }));
    });
    await waitFor(() => expect(result.current.jumlah).toBe(1));
    expect(result.current.terkirim).toBe(false);
  });
});
