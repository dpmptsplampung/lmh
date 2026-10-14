// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

const ME = 'pet-1';
const SESI = 's1';
let row: Record<string, unknown>;

const row0 = () => ({
  id: SESI, status: 'eskalasi', layanan_id: 'l1', pengunjung_id: null, ditangani_oleh: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  last_pesan: 'halo', last_pesan_at: '2026-01-01T00:00:01Z', last_pengirim: 'pengunjung', unread: true,
});

vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/layout/PageHeader', () => ({ default: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => {
  const q = (data: unknown) => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'is', 'order']) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data });
    b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: Array.isArray(data) ? data : [data] }).then(r);
    return b;
  };
  const channel = { on: () => channel, subscribe: (cb?: (s: string) => void) => { cb?.('SUBSCRIBED'); return channel; } };
  return {
    createClient: () => ({
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
      from: (t: string) =>
        t === 'petugas' ? q({ id: ME, role: 'petugas', layanan_id: 'l1', nama: 'Budi' })
        : t === 'layanan' ? q({ id: 'l1', nama: 'Helpdesk OSS', aktif: true, punya_chat: true })
        : t === 'penanganan' ? q([])
        : q({ kontak_pengunjung: 'Ani' }),
      rpc: () => Promise.resolve({ data: [row], error: null }),
      channel: () => channel,
      removeChannel: () => {},
    }),
  };
});

import AdminChatPage from './page';

describe('admin chat: Ambil Chat -> kotak balasan', () => {
  beforeEach(() => {
    row = row0();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/chat/sesi')) {
        row = { ...row, status: 'aktif', ditangani_oleh: ME };
        return { ok: true, status: 200, json: async () => ({ ok: true, aksi: 'takeover', data: { ok: true, peran_tahap: 'layanan' } }) };
      }
      return { ok: true, status: 200, json: async () => ({ messages: [], status: row.status }) };
    }));
    Element.prototype.scrollIntoView = vi.fn();
    // Hari kerja (Rabu): pada hari tanpa pelayanan tombol Ambil Chat sengaja nonaktif.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T10:00:00+07:00'));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('kotak balasan muncul dan aktif setelah petugas mengambil chat', async () => {
    render(<AdminChatPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Helpdesk OSS/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Ambil Chat/ }));
    await waitFor(() => expect(screen.getByText(/Ditangani oleh Anda/)).toBeTruthy());
    // chatscope menaruh placeholder di atribut data-placeholder pada editor contenteditable.
    await waitFor(() => {
      const box = document.querySelector('[data-placeholder="Ketik balasan Anda..."]');
      expect(box).not.toBeNull();
      expect(box!.getAttribute('contenteditable')).toBe('true');
    });
  });

  it('kembali ke daftar menandai sesi terbaca: titik unread tidak muncul lagi', async () => {
    render(<AdminChatPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Helpdesk OSS/ }));
    // Pesan baru masuk saat sesi terbuka (refetch daftar lewat Ambil Chat).
    row = { ...row, last_pesan_at: '2026-01-01T00:05:00Z' };
    fireEvent.click(await screen.findByRole('button', { name: /Ambil Chat/ }));
    await waitFor(() => expect(screen.getByText(/Ditangani oleh Anda/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Daftar sesi/ }));
    const item = await screen.findByRole('button', { name: /Helpdesk OSS/ });
    expect(item.querySelector('[aria-label="Pesan belum dibalas"]')).toBeNull();
  });
});
