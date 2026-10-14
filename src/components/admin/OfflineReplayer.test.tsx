// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { replayMock, getSessionMock, toastMock } = vi.hoisted(() => ({
  replayMock: vi.fn(),
  getSessionMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { getSession: getSessionMock } }) }));
vi.mock('@/lib/offline/replay', () => ({ replayQueue: replayMock }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: toastMock }) }));

import OfflineReplayer from './OfflineReplayer';

describe('OfflineReplayer (replay antrean offline FO)', () => {
  let swListeners: Record<string, (e: unknown) => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    swListeners = {};
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: 'fo-1' } } } });
    replayMock.mockResolvedValue({ synced: 0, failed: 0 });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        addEventListener: (nama: string, fn: (e: unknown) => void) => {
          swListeners[nama] = fn;
        },
        removeEventListener: vi.fn(),
      },
    });
  });

  afterEach(() => {
    cleanup();
    // @ts-expect-error pembersihan stub
    delete navigator.serviceWorker;
  });

  it('memutar ulang saat halaman dibuka, untuk akun yang sedang masuk', async () => {
    render(<OfflineReplayer />);
    await waitFor(() => expect(replayMock).toHaveBeenCalledWith('fo-1'));
  });

  it('tanpa sesi tidak memutar apa pun', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    render(<OfflineReplayer />);
    await waitFor(() => expect(getSessionMock).toHaveBeenCalled());
    expect(replayMock).not.toHaveBeenCalled();
  });

  it('memberi tahu FO: berhasil terkirim, dan yang ditolak/kedaluwarsa (tidak diam-diam hilang)', async () => {
    replayMock.mockResolvedValueOnce({ synced: 2, failed: 0 });
    render(<OfflineReplayer />);
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('2 pendaftaran walk-in offline berhasil dikirim'), 'success'));

    replayMock.mockResolvedValueOnce({ synced: 0, failed: 0, ditolak: 1 });
    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('ditolak server'), 'error'));
  });

  it("event 'online' memicu replay", async () => {
    render(<OfflineReplayer />);
    await waitFor(() => expect(replayMock).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(replayMock).toHaveBeenCalledTimes(2));
  });

  it('pesan REPLAY_QUEUE dari service worker dibalas lewat port: ok true bila semua terkirim', async () => {
    render(<OfflineReplayer />);
    await waitFor(() => expect(swListeners.message).toBeDefined());
    await waitFor(() => expect(replayMock).toHaveBeenCalledTimes(1));

    const port = { postMessage: vi.fn() };
    swListeners.message({ data: { type: 'REPLAY_QUEUE' }, ports: [port] });
    await waitFor(() => expect(port.postMessage).toHaveBeenCalledWith({ ok: true }));
  });

  it('balasan ok:false bila masih ada item yang gagal (SW menjadwalkan ulang sync)', async () => {
    render(<OfflineReplayer />);
    await waitFor(() => expect(swListeners.message).toBeDefined());
    await waitFor(() => expect(replayMock).toHaveBeenCalledTimes(1));

    replayMock.mockResolvedValue({ synced: 0, failed: 1 });
    const port = { postMessage: vi.fn() };
    swListeners.message({ data: { type: 'REPLAY_QUEUE' }, ports: [port] });
    await waitFor(() => expect(port.postMessage).toHaveBeenCalledWith({ ok: false }));
  });

  it('pesan bertipe lain diabaikan', async () => {
    render(<OfflineReplayer />);
    await waitFor(() => expect(swListeners.message).toBeDefined());
    await waitFor(() => expect(replayMock).toHaveBeenCalledTimes(1));
    const port = { postMessage: vi.fn() };
    swListeners.message({ data: { type: 'LAIN' }, ports: [port] });
    await new Promise((r) => setTimeout(r, 20));
    expect(port.postMessage).not.toHaveBeenCalled();
    expect(replayMock).toHaveBeenCalledTimes(1);
  });
});
