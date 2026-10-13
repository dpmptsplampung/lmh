// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  signOut: vi.fn(),
  navigasi: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ rpc: h.rpc, auth: { signOut: h.signOut } }),
}));

import { useSesiStaf } from './useSesiStaf';

const OK = { data: { valid: true, status: 'ok', tutup: false, idle_menit: 120 }, error: null };
const panggilan = (nama: string) => h.rpc.mock.calls.filter((c) => c[0] === nama);

function pasang() {
  return renderHook(() => useSesiStaf({ intervalMs: 60_000, tenggangTutupDetik: 60, navigasi: h.navigasi }));
}

describe('useSesiStaf', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.rpc.mockReset();
    h.signOut.mockReset().mockResolvedValue({ error: null });
    h.navigasi.mockReset();
    h.rpc.mockResolvedValue(OK);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ping saat dipasang lalu tiap interval; berhenti saat dilepas', async () => {
    const { unmount } = pasang();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(panggilan('ping_sesi')).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(panggilan('ping_sesi')).toHaveLength(2);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(180_000); });
    expect(panggilan('ping_sesi')).toHaveLength(2);
  });

  it('p_aktif true hanya bila ada input pengguna sejak ping sebelumnya', async () => {
    pasang();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(h.rpc).toHaveBeenLastCalledWith('ping_sesi', { p_aktif: true }); // muat halaman = aktivitas
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(h.rpc).toHaveBeenLastCalledWith('ping_sesi', { p_aktif: false }); // tak ada input
    act(() => { window.dispatchEvent(new Event('keydown')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(h.rpc).toHaveBeenLastCalledWith('ping_sesi', { p_aktif: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(h.rpc).toHaveBeenLastCalledWith('ping_sesi', { p_aktif: false });
  });

  it('status transisi: daftarkan_sesi sekali lalu lanjut', async () => {
    h.rpc.mockImplementation(async (nama: string) => (
      nama === 'ping_sesi'
        ? { data: { valid: true, status: 'transisi', tutup: false }, error: null }
        : { data: { ok: true }, error: null }
    ));
    pasang();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(panggilan('daftarkan_sesi')).toHaveLength(1);
    expect(h.navigasi).not.toHaveBeenCalled();
  });

  it.each(['digantikan', 'idle', 'tidak_terdaftar'])(
    'sesi tak sah (%s): keluar lokal + /login?alasan=..., TANPA daftarkan_sesi',
    async (alasan) => {
      h.rpc.mockResolvedValue({ data: { valid: false, status: alasan, alasan, tutup: false }, error: null });
      pasang();
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(h.signOut).toHaveBeenCalledWith({ scope: 'local' });
      expect(h.navigasi).toHaveBeenCalledWith(`/login?alasan=${alasan}`);
      expect(panggilan('daftarkan_sesi')).toHaveLength(0);
      expect(panggilan('akhiri_sesi')).toHaveLength(0);
    },
  );

  it('kegagalan jaringan/RPC tidak mengeluarkan pengguna dan dicoba lagi di siklus berikut', async () => {
    h.rpc.mockRejectedValueOnce(new TypeError('fetch failed'));
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'timeout', code: '' } });
    pasang();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(h.navigasi).not.toHaveBeenCalled();
    expect(h.signOut).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(panggilan('ping_sesi')).toHaveLength(3);
    expect(h.navigasi).not.toHaveBeenCalled();
  });

  it('tab tersembunyi tetap berdetak tetapi melaporkan p_aktif false', async () => {
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      pasang();
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(h.rpc).toHaveBeenLastCalledWith('ping_sesi', { p_aktif: false });
    } finally {
      spy.mockRestore();
    }
  });

  it('tutup: peringatan selama tenggang, lalu akhiri_sesi + keluar alasan=tutup', async () => {
    h.rpc.mockImplementation(async (nama: string) => (
      nama === 'ping_sesi'
        ? { data: { valid: true, status: 'ok', tutup: true }, error: null }
        : { data: { ok: true }, error: null }
    ));
    const { result } = pasang();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.sisaTutupDetik).toBe(60);
    expect(h.navigasi).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(result.current.sisaTutupDetik).toBe(30);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(panggilan('akhiri_sesi')).toHaveLength(1);
    expect(h.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(h.navigasi).toHaveBeenCalledTimes(1);
    expect(h.navigasi).toHaveBeenCalledWith('/login?alasan=tutup');
  });

  it('di tengah tenggang, sesi digantikan membatalkan peringatan dan keluar sekali saja', async () => {
    let n = 0;
    h.rpc.mockImplementation(async () => {
      n += 1;
      return n === 1
        ? { data: { valid: true, status: 'ok', tutup: true }, error: null }
        : { data: { valid: false, status: 'digantikan', alasan: 'digantikan', tutup: false }, error: null };
    });
    pasang();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(h.navigasi).toHaveBeenCalledTimes(1);
    expect(h.navigasi).toHaveBeenCalledWith('/login?alasan=digantikan');
  });
});
