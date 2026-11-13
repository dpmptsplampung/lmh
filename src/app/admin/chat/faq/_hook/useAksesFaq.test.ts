// @vitest-environment jsdom
// Kontrak useAksesFaq (tugas 8.2): galat peran dibedakan dari tanpa akses, kegagalan layanan, muat ulang, dan bot hanya Admin.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { HasilFaq, LayananFaq } from '@/lib/data/faq';

const m = vi.hoisted(() => ({ muatProfilFaq: vi.fn(), muatLayananFaq: vi.fn(), ubahBotLayanan: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('@/lib/data/faq', () => m);

import { useAksesFaq } from './useAksesFaq';

const ok = <T,>(data: T): HasilFaq<T> => ({ data, error: null });
const galat = <T,>(pesan: string): HasilFaq<T> => ({ data: null, error: { jenis: 'database', pesan, asli: null, perluMuatUlang: false } });
const L1: LayananFaq = { id: 'l1', nama: 'Helpdesk OSS', chatbot_aktif: true };
const toast = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  m.muatProfilFaq.mockResolvedValue(ok({ role: 'admin', layananId: null }));
  m.muatLayananFaq.mockResolvedValue(ok([L1]));
  m.ubahBotLayanan.mockResolvedValue(ok(null));
});
afterEach(cleanup);

describe('useAksesFaq', () => {
  it('memuat peran dan layanan lalu menurunkan akses', async () => {
    const { result } = renderHook(() => useAksesFaq({ toast }));
    await waitFor(() => expect(result.current.siapMuat).toBe(true));
    expect(result.current).toMatchObject({ isAdmin: true, roleError: false, tanpaAkses: false, tampilPanelBot: true });
    expect(result.current.lingkup).toEqual({ jenis: 'semua' });
  });

  it('galat membaca peran = roleError + toast (bukan tanpa akses); muat ulang pulih', async () => {
    m.muatProfilFaq.mockResolvedValueOnce(galat('x'));
    const { result } = renderHook(() => useAksesFaq({ toast }));
    await waitFor(() => expect(result.current.roleError).toBe(true));
    expect(toast).toHaveBeenCalledWith('Gagal memuat hak akses Anda', 'error');
    expect(result.current.role).toBeNull();
    expect(result.current.tanpaAkses).toBe(false);
    act(() => result.current.muatUlangRole());
    await waitFor(() => expect(result.current.roleError).toBe(false));
    expect(result.current.role).toBe('admin');
    expect(result.current.roleMemuat).toBe(false);
  });

  it('gagal memuat layanan memblokir admin tetapi tidak Front Office', async () => {
    m.muatLayananFaq.mockResolvedValue(galat('x'));
    const adm = renderHook(() => useAksesFaq({ toast }));
    await waitFor(() => expect(adm.result.current.layananGagalBlokir).toBe(true));
    m.muatProfilFaq.mockResolvedValue(ok({ role: 'front_office', layananId: null }));
    const fo = renderHook(() => useAksesFaq({ toast }));
    await waitFor(() => expect(fo.result.current.siapMuat).toBe(true));
    expect(fo.result.current.layananGagalBlokir).toBe(false);
  });

  it('alih bot (Admin): memperbarui status di tempat dan menampilkan toast; galat memakai pesan data', async () => {
    const { result } = renderHook(() => useAksesFaq({ toast }));
    await waitFor(() => expect(result.current.siapMuat).toBe(true));
    await act(async () => { await result.current.ubahBot('l1', true); });
    expect(m.ubahBotLayanan).toHaveBeenCalledWith({}, 'l1', false);
    expect(toast).toHaveBeenCalledWith('Bot layanan ini dinonaktifkan.', 'success');
    expect(result.current.botLayanan?.chatbot_aktif).toBe(false);
    m.ubahBotLayanan.mockResolvedValueOnce(galat('Anda tidak berwenang'));
    await act(async () => { await result.current.ubahBot('l1', false); });
    expect(toast).toHaveBeenLastCalledWith('Gagal memperbarui status bot. Anda tidak berwenang', 'error');
    expect(result.current.botLayanan?.chatbot_aktif).toBe(false);
  });

  it('alih bot ditolak untuk non-Admin (dijaga di handler)', async () => {
    m.muatProfilFaq.mockResolvedValue(ok({ role: 'petugas', layananId: 'l1' }));
    const { result } = renderHook(() => useAksesFaq({ toast }));
    await waitFor(() => expect(result.current.siapMuat).toBe(true));
    await act(async () => { await result.current.ubahBot('l1', true); });
    expect(m.ubahBotLayanan).not.toHaveBeenCalled();
  });
});
