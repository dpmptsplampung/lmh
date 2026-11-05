// @vitest-environment jsdom
// Gaya "Dasbor" untuk /chat: bilah atas tanpa sidebar, tema dasbor, tautan keluar chat tetap tersedia.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

import PublicChatPage from './page';
import { createClient } from '@/lib/supabase/client';
import { barisRpc, siapkanHarness } from './chat.test-utils';

describe('chat pengunjung: bilah atas gaya Dasbor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('akar halaman memakai tema dasbor, ada judul Live Chat, dan tidak ada sidebar', async () => {
    siapkanHarness(createClient, { rpcDaftar: [barisRpc()] });
    const { container } = render(<PublicChatPage />);
    await screen.findByRole('button', { name: /buka percakapan/i });
    expect(container.querySelector('[data-tema="dasbor"]')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Live Chat' })).toBeInTheDocument();
    expect(container.querySelector('aside')).toBeNull();
  });

  it('tautan lama tetap ada: logo ke beranda situs dan Kembali ke Web; ditambah Beranda saya', async () => {
    siapkanHarness(createClient, { rpcDaftar: [barisRpc()] });
    render(<PublicChatPage />);
    await screen.findByRole('button', { name: /buka percakapan/i });
    const nav = screen.getByRole('navigation', { name: 'Navigasi chat' });
    expect(nav.querySelector('a[href="/me"]')).toHaveTextContent('Beranda saya');
    expect(nav.querySelector('a[href="/"]')).toHaveTextContent('Kembali ke Web');
    expect(screen.getByRole('link', { name: /Lampung Maju Hub Logo/i })).toHaveAttribute('href', '/');
  });
});
