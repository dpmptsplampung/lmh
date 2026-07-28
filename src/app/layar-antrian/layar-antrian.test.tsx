// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

import LayarAntrianPage from './page';
import { createClient } from '@/lib/supabase/client';

interface LoketRow {
  layanan_id: string;
  layanan_nama: string;
  tipe: string;
  antre_count: number;
  dilayani_count: number;
  estimasi_durasi_menit: number;
  estimasi_tunggu_total_menit: number;
}

const buildMockSupabase = (rows: LoketRow[], opts: { error?: boolean } = {}) => {
  const channelApi = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
  };
  const mock = {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: opts.error ? null : rows,
        error: opts.error ? new Error('fetch failed') : null,
      }),
    })),
    channel: vi.fn(() => channelApi),
    removeChannel: vi.fn().mockResolvedValue('ok'),
  };
  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mock);
  return mock;
};

const row = (over: Partial<LoketRow> = {}): LoketRow => ({
  layanan_id: 'l1',
  layanan_nama: 'Helpdesk OSS',
  tipe: 'konsultatif',
  antre_count: 0,
  dilayani_count: 0,
  estimasi_durasi_menit: 15,
  estimasi_tunggu_total_menit: 0,
  ...over,
});

describe('Layar Antrian (public display)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders all loket with queue counts', async () => {
    buildMockSupabase([
      row({ layanan_id: 'l1', layanan_nama: 'Helpdesk OSS', antre_count: 3, dilayani_count: 1, estimasi_tunggu_total_menit: 45 }),
      row({ layanan_id: 'l2', layanan_nama: 'BPJS Kesehatan', antre_count: 0, dilayani_count: 0 }),
    ]);
    render(<LayarAntrianPage />);

    await waitFor(() => expect(screen.getByText('Helpdesk OSS')).toBeInTheDocument());
    expect(screen.getByText('BPJS Kesehatan')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument(); // sisa antrean
    expect(screen.getByText('1')).toBeInTheDocument(); // sedang dilayani
    expect(screen.getByText(/±45 menit/)).toBeInTheDocument();
  });

  it('shows "tidak ada antrean" guidance for empty loket', async () => {
    buildMockSupabase([row()]);
    render(<LayarAntrianPage />);

    await waitFor(() =>
      expect(screen.getByText(/Tidak ada antrean — silakan langsung ke loket/)).toBeInTheDocument(),
    );
  });

  it('shows error message when fetch fails', async () => {
    buildMockSupabase([], { error: true });
    render(<LayarAntrianPage />);

    await waitFor(() =>
      expect(screen.getByText(/Gagal memuat data antrean/)).toBeInTheDocument(),
    );
  });

  it('removes realtime channel on unmount', async () => {
    const mock = buildMockSupabase([]);
    const { unmount } = render(<LayarAntrianPage />);

    await waitFor(() => expect(mock.channel).toHaveBeenCalled());
    unmount();
    expect(mock.removeChannel).toHaveBeenCalled();
  });
});
