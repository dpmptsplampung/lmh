// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

// Sesi dipulihkan dari localStorage: nama layanan di banner & label petugas harus
// berasal dari layanan milik SESI (chat_sesi.layanan_id), bukan dropdown/URL.
vi.mock('@/lib/supabase/client', () => {
  const q = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const k of ['select', 'eq', 'neq', 'order']) b[k] = () => b;
    b.single = () =>
      Promise.resolve({
        data:
          table === 'chat_sesi'
            ? { status: 'aktif', kontak_pengunjung: 'Budi', layanan_id: 'l2' }
            : table === 'pengunjung'
              ? { id: 'p1', nama: 'Budi' }
              : null,
        error: null,
      });
    b.then = (r: (v: unknown) => unknown) =>
      Promise.resolve({
        data:
          table === 'v_layanan_publik'
            ? [
                { id: 'l1', nama: 'Bank Lampung', chatbot_aktif: true },
                { id: 'l2', nama: 'Helpdesk OSS', chatbot_aktif: true },
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

describe('chat pengunjung: nama layanan pada sesi yang dipulihkan', () => {
  beforeEach(() => {
    localStorage.setItem('lmh_chat_sesi_id', 's1');
    // localStorage sengaja menyimpan layanan LAIN: sumber kebenaran = chat_sesi.layanan_id.
    localStorage.setItem('lmh_chat_layanan_id', 'l1');
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
    await waitFor(() =>
      expect(screen.getByText('Terhubung langsung dengan Petugas Helpdesk OSS')).toBeTruthy(),
    );
    await waitFor(() => expect(screen.getAllByText('Petugas Helpdesk OSS').length).toBeGreaterThan(0));
  });
});

describe('chat pengunjung: SSR tidak merender banner offline', () => {
  it('HTML server (navigator.onLine undefined seperti Node) berisi form, bukan alert offline', async () => {
    const { renderToString } = await import('react-dom/server');
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
    Object.defineProperty(navigator, 'onLine', { value: undefined, configurable: true });
    try {
      const html = renderToString(<PublicChatPage />);
      expect(html).toContain('<form');
      expect(html).not.toContain('form-error');
    } finally {
      delete (navigator as unknown as Record<string, unknown>).onLine;
      if (desc) Object.defineProperty(Navigator.prototype, 'onLine', desc);
    }
  });
});
