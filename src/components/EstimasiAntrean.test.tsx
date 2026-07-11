// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

import EstimasiAntrean from './EstimasiAntrean';
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

const buildMockSupabase = (rows: LoketRow[] = [], opts: { error?: boolean } = {}) => {
  const refetch = vi.fn().mockResolvedValue({ data: rows, error: null });
  const selectChain = {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({
      data: opts.error ? null : rows,
      error: opts.error ? new Error('fetch failed') : null,
    }),
  };

  const channelApi = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockImplementation((cb?: (status: string) => void) => {
      if (typeof cb === 'function') cb('SUBSCRIBED');
      return channelApi;
    }),
    unsubscribe: vi.fn().mockResolvedValue('ok'),
  };

  const mock = {
    from: vi.fn(() => selectChain),
    channel: vi.fn(() => channelApi),
    _refetch: refetch,
    _selectChain: selectChain,
    _channelApi: channelApi,
  };

  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mock);
  return mock;
};

describe('I2 EstimasiAntrean component: smoke tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the section header', async () => {
    buildMockSupabase([]);
    render(<EstimasiAntrean />);

    await waitFor(() => {
      expect(screen.getByText(/Estimasi Antrean Sekarang/i)).toBeInTheDocument();
    });
  });

  it('renders a card per loket with nama, estimasi, and antre count', async () => {
    buildMockSupabase([
      {
        layanan_id: 'l-1',
        layanan_nama: 'Helpdesk OSS',
        tipe: 'konsultatif',
        antre_count: 3,
        dilayani_count: 1,
        estimasi_durasi_menit: 15,
        estimasi_tunggu_total_menit: 45,
      },
    ]);
    render(<EstimasiAntrean />);

    await waitFor(() => {
      expect(screen.getByText('Helpdesk OSS')).toBeInTheDocument();
    });
    expect(screen.getByText(/45 menit/)).toBeInTheDocument();
    expect(screen.getByText(/3 antre/)).toBeInTheDocument();
  });

  it('shows "Tidak ada antrean" badge when antre_count is 0', async () => {
    buildMockSupabase([
      {
        layanan_id: 'l-1',
        layanan_nama: 'Helpdesk OSS',
        tipe: 'konsultatif',
        antre_count: 0,
        dilayani_count: 0,
        estimasi_durasi_menit: 15,
        estimasi_tunggu_total_menit: 0,
      },
    ]);
    render(<EstimasiAntrean />);

    await waitFor(() => {
      expect(screen.getByText(/Tidak ada antrean/i)).toBeInTheDocument();
    });
  });

  it('handles empty state when no konsultatif layanan exist', async () => {
    buildMockSupabase([]);
    render(<EstimasiAntrean />);

    await waitFor(() => {
      expect(screen.getByText(/Estimasi Antrean Sekarang/i)).toBeInTheDocument();
    });
    // No loket cards — should show a friendly empty message
    expect(screen.getByText(/Belum ada data antrean|Tidak ada loket/i)).toBeInTheDocument();
  });

  it('subscribes to Supabase Realtime on the visit table', async () => {
    const mock = buildMockSupabase([]);
    render(<EstimasiAntrean />);

    await waitFor(() => {
      expect(mock.channel).toHaveBeenCalled();
    });
    expect(mock._channelApi.on).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({ event: '*', schema: 'public', table: 'visit' }),
      expect.any(Function),
    );
    expect(mock._channelApi.subscribe).toHaveBeenCalled();
  });

  it('cleans up the Realtime channel on unmount', async () => {
    const mock = buildMockSupabase([]);
    const { unmount } = render(<EstimasiAntrean />);

    await waitFor(() => {
      expect(mock._channelApi.subscribe).toHaveBeenCalled();
    });

    unmount();
    expect(mock._channelApi.unsubscribe).toHaveBeenCalled();
  });

  it('shows red badge styling when estimasi_tunggu_total > 60', async () => {
    buildMockSupabase([
      {
        layanan_id: 'l-1',
        layanan_nama: 'Helpdesk OSS',
        tipe: 'konsultatif',
        antre_count: 6,
        dilayani_count: 1,
        estimasi_durasi_menit: 15,
        estimasi_tunggu_total_menit: 90,
      },
    ]);
    const { container } = render(<EstimasiAntrean />);

    await waitFor(() => {
      expect(screen.getByText(/90 menit/)).toBeInTheDocument();
    });
    // Badge should have a danger/red class
    const badge = container.querySelector('[data-wait-level="danger"]');
    expect(badge).not.toBeNull();
  });

  it('shows orange badge styling when estimasi_tunggu_total is between 30 and 60', async () => {
    buildMockSupabase([
      {
        layanan_id: 'l-1',
        layanan_nama: 'Helpdesk OSS',
        tipe: 'konsultatif',
        antre_count: 3,
        dilayani_count: 1,
        estimasi_durasi_menit: 15,
        estimasi_tunggu_total_menit: 45,
      },
    ]);
    const { container } = render(<EstimasiAntrean />);

    await waitFor(() => {
      expect(screen.getByText(/45 menit/)).toBeInTheDocument();
    });
    const badge = container.querySelector('[data-wait-level="warning"]');
    expect(badge).not.toBeNull();
  });

  it('shows green badge styling when estimasi_tunggu_total <= 30 and antre_count > 0', async () => {
    buildMockSupabase([
      {
        layanan_id: 'l-1',
        layanan_nama: 'Helpdesk OSS',
        tipe: 'konsultatif',
        antre_count: 1,
        dilayani_count: 0,
        estimasi_durasi_menit: 15,
        estimasi_tunggu_total_menit: 15,
      },
    ]);
    const { container } = render(<EstimasiAntrean />);

    await waitFor(() => {
      expect(screen.getByText((_, node) => {
        if (!node) return false;
        const text = node.textContent ?? '';
        return /~15 menit/.test(text) && node.getAttribute('data-wait-level') === 'normal';
      })).toBeInTheDocument();
    });
    const badge = container.querySelector('[data-wait-level="normal"]');
    expect(badge).not.toBeNull();
  });
});
