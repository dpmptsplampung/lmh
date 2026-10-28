// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

// Percakapan dibuka dari daftar: nama layanan di banner & label petugas harus
// berasal dari layanan milik SESI (chat_sesi.layanan_id), bukan dropdown/URL.
vi.mock('@/lib/supabase/client', () => {
  const q = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const k of ['select', 'eq', 'neq', 'order', 'or']) b[k] = () => b;
    b.single = () =>
      Promise.resolve({
        data:
          table === 'chat_sesi'
            ? { status: 'aktif', kontak_pengunjung: 'Budi', layanan_id: '22222222-2222-4222-8222-222222222222' }
            : table === 'pengunjung'
              ? { id: 'p1', nama: 'Budi' }
              : null,
        error: null,
      });
    b.then = (r: (v: unknown) => unknown) =>
      Promise.resolve({
        data:
          table === 'chat_sesi'
            ? [{ id: 's1', layanan_id: '22222222-2222-4222-8222-222222222222', status: 'aktif', created_at: '2026-01-01T00:00:00Z' }]
            : table === 'v_layanan_publik'
            ? [
                { id: '11111111-1111-4111-8111-111111111111', nama: 'Bank Lampung', chatbot_aktif: true },
                { id: '22222222-2222-4222-8222-222222222222', nama: 'Helpdesk OSS', chatbot_aktif: true },
              ]
            : [],
        error: null,
      }).then(r);
    return b;
  };
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    createClient: () => ({
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
      from: q,
      channel: () => channel,
      removeChannel: () => {},
    }),
  };
});

import PublicChatPage from './page';

describe('chat pengunjung: nama layanan pada percakapan yang dibuka', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'aktif',
          messages: [{ id: 'm1', pengirim: 'petugas', isi: 'Halo', created_at: '2026-01-01T00:00:00Z' }],
        }),
      })),
    );
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('banner dan label petugas menyebut layanan sesi', async () => {
    render(<PublicChatPage />);
    fireEvent.click(await screen.findByRole('button', { name: /buka percakapan helpdesk oss/i }));
    await waitFor(() =>
      expect(screen.getByText('Terhubung langsung dengan Petugas Helpdesk OSS')).toBeTruthy(),
    );
    await waitFor(() => expect(screen.getAllByText('Petugas Helpdesk OSS').length).toBeGreaterThan(0));
  });
});

describe('chat pengunjung: SSR tidak merender banner offline', () => {
  it('HTML server (navigator.onLine undefined seperti Node) tidak berisi alert offline', async () => {
    const { renderToString } = await import('react-dom/server');
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
    Object.defineProperty(navigator, 'onLine', { value: undefined, configurable: true });
    try {
      const html = renderToString(<PublicChatPage />);
      // SSR: belum diketahui login/percakapan -> keadaan memuat; tidak ada alert offline.
      expect(html).toContain('Memuat percakapan');
      expect(html).not.toContain('form-error');
      expect(html).not.toContain('role="alert"');
    } finally {
      delete (navigator as unknown as Record<string, unknown>).onLine;
      if (desc) Object.defineProperty(Navigator.prototype, 'onLine', desc);
    }
  });
});
