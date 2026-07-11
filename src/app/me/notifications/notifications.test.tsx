// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@/lib/supabase/client';
import NotificationsPage from './page';

interface NotifRow {
  id: string;
  kanal: 'email' | 'web_push';
  subjek: string | null;
  body: string;
  status: string;
  created_at: string;
}

const buildMockSupabase = (rows: NotifRow[] = []) => {
  const authUser = { id: 'user-1', email: 'me@example.com' };
  const authGetUser = vi.fn().mockResolvedValue({
    data: { user: authUser },
    error: null,
  });

  const notifChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };

  const pushSubChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data: [], error: null }),
  };

  const mock = {
    auth: { getUser: authGetUser },
    from: vi.fn((table: string) => {
      if (table === 'notifikasi') return notifChain;
      if (table === 'push_subscriptions') return pushSubChain;
      return {};
    }),
    _notifChain: notifChain,
    _pushSubChain: pushSubChain,
    _authUser: authUser,
  };

  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mock);
  return mock;
};

describe('I5 /me/notifications page — smoke tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom doesn't implement serviceWorker — leave it undefined so the page
    // treats push as unsupported (graceful path).
    // @ts-expect-error narrowing test env
    delete navigator.serviceWorker;
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the page heading', async () => {
    buildMockSupabase([]);
    render(<NotificationsPage />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Notifikasi/i })).toBeInTheDocument();
    });
  });

  it('lists recent notifications with subject and body', async () => {
    buildMockSupabase([
      {
        id: 'n1',
        kanal: 'email',
        subjek: 'Survei Kepuasan Masyarakat — DPMPTSP Lampung',
        body: 'Layanan Anda telah selesai. Mohon isi survei: https://lmh.lampungprov.go.id/skm?token=abc',
        status: 'sent',
        created_at: new Date().toISOString(),
      },
      {
        id: 'n2',
        kanal: 'email',
        subjek: 'Listing UMKM Anda Disetujui — DPMPTSP Lampung',
        body: 'Listing "Kopi Lampung" telah disetujui dan tayang di marketplace.',
        status: 'pending',
        created_at: new Date().toISOString(),
      },
    ]);
    render(<NotificationsPage />);
    await waitFor(() => {
      expect(screen.getByText(/Survei Kepuasan Masyarakat/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Listing UMKM Anda Disetujui/i)).toBeInTheDocument();
  });

  it('shows a friendly empty state when there are no notifications', async () => {
    buildMockSupabase([]);
    render(<NotificationsPage />);
    await waitFor(() => {
      expect(screen.getByText(/Belum ada notifikasi|Tidak ada notifikasi/i)).toBeInTheDocument();
    });
  });

  it('shows push toggle (disabled when serviceWorker unsupported)', async () => {
    buildMockSupabase([]);
    render(<NotificationsPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Aktifkan notifikasi push/i })).toBeDisabled();
    });
  });
});
