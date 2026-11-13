// @vitest-environment jsdom
// useReferensiChat (tugas 6.5): data awal dari server dipakai tanpa query browser; null/tidak ada = dimuat dari browser.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const data = vi.hoisted(() => ({ layanan: vi.fn(), faq: vi.fn(), klien: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => (data.klien(), {}) }));
vi.mock('@/lib/data/chat-pengunjung', async (asli) => ({
  ...(await asli<typeof import('@/lib/data/chat-pengunjung')>()),
  muatLayananChat: data.layanan,
  muatFaqChat: data.faq,
}));

import type { FaqChat, LayananChat } from '@/lib/data/chat-pengunjung';
import { useReferensiChat } from './useReferensiChat';

const L1 = '11111111-1111-4111-8111-111111111111';
const L2 = '22222222-2222-4222-8222-222222222222';
const layananAwal: LayananChat[] = [{ id: L1, nama: 'Bank', chatbot_aktif: true, status_tampilan: 'aktif', punya_chat: true }];
const faq = (id: string, layanan_id: string | null, urutan: number): FaqChat => ({ id, pertanyaan: id, jawaban: id, layanan_id, urutan });

beforeEach(() => {
  data.layanan.mockReset();
  data.faq.mockReset();
  data.klien.mockReset();
  data.layanan.mockResolvedValue({ data: layananAwal, error: null });
  data.faq.mockResolvedValue({ data: [], error: null });
});
afterEach(cleanup);

describe('useReferensiChat dengan data awal dari server', () => {
  it('Layanan awal langsung siap dan tidak ada query dari browser', async () => {
    const { result } = renderHook(() => useReferensiChat({ layanan: layananAwal, faq: [] }));
    expect(result.current.layanan).toEqual(layananAwal);
    expect(result.current.memuatLayanan).toBe(false);
    expect(result.current.galatLayanan).toBe(false);
    await Promise.resolve();
    expect(data.layanan).not.toHaveBeenCalled();
    expect(data.klien).not.toHaveBeenCalled();
  });

  it('daftar Layanan kosong yang sah dari server tetap dipakai (tanpa query)', () => {
    const { result } = renderHook(() => useReferensiChat({ layanan: [], faq: [] }));
    expect(result.current.memuatLayanan).toBe(false);
    expect(data.layanan).not.toHaveBeenCalled();
  });

  it('FAQ: memilih FAQ layanan + umum dari data awal (layanan lebih dulu) tanpa query', async () => {
    const { result } = renderHook(() =>
      useReferensiChat({ layanan: layananAwal, faq: [faq('umum', null, 1), faq('l2', L2, 2), faq('l1', L1, 3)] }),
    );
    await act(() => result.current.muatFaq(L1));
    expect(result.current.faq.map((x) => x.id)).toEqual(['l1', 'umum']);
    expect(result.current.galatFaq).toBe(false);
    expect(result.current.memuatFaq).toBe(false);
    expect(data.faq).not.toHaveBeenCalled();
  });

  it('Coba lagi memuat Layanan dari browser walau ada data awal', async () => {
    const { result } = renderHook(() => useReferensiChat({ layanan: layananAwal, faq: [] }));
    act(() => result.current.cobaLagiLayanan());
    await waitFor(() => expect(data.layanan).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.memuatLayanan).toBe(false));
  });
});

describe('useReferensiChat tanpa data awal (null atau tidak ada)', () => {
  it('Layanan null: dimuat dari browser (perilaku lama)', async () => {
    const { result } = renderHook(() => useReferensiChat({ layanan: null, faq: null }));
    expect(result.current.memuatLayanan).toBe(true);
    await waitFor(() => expect(result.current.memuatLayanan).toBe(false));
    expect(result.current.layanan).toEqual(layananAwal);
    expect(data.layanan).toHaveBeenCalledTimes(1);
  });

  it('tanpa argumen: Layanan dimuat dari browser; galat -> galatLayanan', async () => {
    data.layanan.mockResolvedValue({ data: [], error: { jenis: 'http', pesan: 'x' } });
    const { result } = renderHook(() => useReferensiChat());
    await waitFor(() => expect(result.current.galatLayanan).toBe(true));
    expect(result.current.layanan).toEqual([]);
  });

  it('FAQ null: dimuat per layanan dari browser dan diurutkan', async () => {
    data.faq.mockResolvedValue({ data: [faq('umum', null, 1), faq('l1', L1, 2)], error: null });
    const { result } = renderHook(() => useReferensiChat({ layanan: layananAwal, faq: null }));
    await act(() => result.current.muatFaq(L1));
    expect(data.faq).toHaveBeenCalledWith(expect.anything(), L1);
    expect(result.current.faq.map((x) => x.id)).toEqual(['l1', 'umum']);
  });
});
