// @vitest-environment jsdom
// Kontrak useReferensiStaf (tugas 7.2): nama Layanan/petugas, tujuan teruskan (aktif + ber-chat), topik FO hanya untuk
// Front Office/Admin, dan tanpa cache lintas mount (ttlMs 0).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';

const d = vi.hoisted(() => ({ layanan: vi.fn(), petugas: vi.fn(), topik: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('@/lib/data/chat-staf', () => ({
  muatLayananChatStaf: d.layanan,
  muatNamaPetugasChat: d.petugas,
  muatTopikFoChat: d.topik,
}));

import { useReferensiStaf } from './useReferensiStaf';

beforeEach(() => {
  vi.clearAllMocks();
  d.layanan.mockResolvedValue({
    data: [
      { id: 'l1', nama: 'Helpdesk OSS', aktif: true, punya_chat: true },
      { id: 'l2', nama: 'BPJS', aktif: true, punya_chat: false },
      { id: 'l3', nama: 'Lama', aktif: false, punya_chat: true },
      { id: 'l4', nama: 'Tanpa kolom aktif', aktif: null, punya_chat: true },
    ],
    error: null,
  });
  d.petugas.mockResolvedValue({ data: [{ id: 'p1', nama: 'Sari' }], error: null });
  d.topik.mockResolvedValue({ data: [{ id: 't1', nama: 'Informasi', urut: 1 }], error: null });
});
afterEach(cleanup);

describe('useReferensiStaf', () => {
  it('peta nama dan tujuan teruskan hanya Layanan aktif yang melayani chat (aktif null dianggap aktif)', async () => {
    const { result } = renderHook(() => useReferensiStaf('admin'));
    await waitFor(() => expect(result.current.layananNama.l1).toBe('Helpdesk OSS'));
    expect(result.current.layananNama).toMatchObject({ l2: 'BPJS', l3: 'Lama' });
    expect(result.current.petugasNama).toEqual({ p1: 'Sari' });
    expect(result.current.layananChat).toEqual([{ id: 'l1', nama: 'Helpdesk OSS' }, { id: 'l4', nama: 'Tanpa kolom aktif' }]);
  });

  it.each([['front_office'], ['admin']] as const)('%s memuat topik FO', async (role) => {
    const { result } = renderHook(() => useReferensiStaf(role));
    await waitFor(() => expect(result.current.topikFo).toHaveLength(1));
    expect(d.topik).toHaveBeenCalledTimes(1);
  });

  it.each([['petugas'], [null]] as const)('%s tidak memuat topik FO', async (role) => {
    const { result } = renderHook(() => useReferensiStaf(role));
    await waitFor(() => expect(result.current.layananChat.length).toBeGreaterThan(0));
    expect(result.current.topikFo).toEqual([]);
    expect(d.topik).not.toHaveBeenCalled();
  });

  it('peran baru diketahui belakangan: topik FO dimuat saat peran terisi', async () => {
    const { result, rerender } = renderHook(({ role }: { role: 'admin' | null }) => useReferensiStaf(role), { initialProps: { role: null as 'admin' | null } });
    await waitFor(() => expect(result.current.layananChat.length).toBeGreaterThan(0));
    expect(d.topik).not.toHaveBeenCalled();
    rerender({ role: 'admin' });
    await waitFor(() => expect(result.current.topikFo).toHaveLength(1));
  });

  it('gagal memuat = daftar kosong; mount berikutnya memuat lagi (tanpa cache)', async () => {
    d.layanan.mockResolvedValueOnce({ data: null, error: 'putus' });
    const a = renderHook(() => useReferensiStaf('petugas'));
    await waitFor(() => expect(d.layanan).toHaveBeenCalledTimes(1));
    expect(a.result.current.layananNama).toEqual({});
    expect(a.result.current.layananChat).toEqual([]);
    a.unmount();
    const b = renderHook(() => useReferensiStaf('petugas'));
    await waitFor(() => expect(b.result.current.layananChat.length).toBeGreaterThan(0));
    expect(d.layanan).toHaveBeenCalledTimes(2);
  });
});
