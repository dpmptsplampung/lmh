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

const buildMockSupabase = (
  rows: LoketRow[] = [],
  opts: { error?: boolean; holiday?: string | null; bukaStatus?: boolean[] } = {},
) => {
  const selectChain = {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({
      data: opts.error ? null : rows,
      error: opts.error ? new Error('fetch failed') : null,
    }),
  };

  const hariLiburData = opts.holiday
    ? [{ keterangan: opts.holiday }]
    : null;

  const hariLiburChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: hariLiburData, error: null }),
  };

  const channelApi = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockImplementation((cb?: (status: string) => void) => {
      if (typeof cb === 'function') cb('SUBSCRIBED');
      return channelApi;
    }),
    unsubscribe: vi.fn().mockResolvedValue('ok'),
  };

  const bukaQueue = opts.bukaStatus ? [...opts.bukaStatus] : null;

  const rpc = vi.fn(() => {
    if (bukaQueue && bukaQueue.length > 0) {
      return Promise.resolve({ data: bukaQueue.shift(), error: null });
    }
    return Promise.resolve({ data: true, error: null });
  });

  const mock = {
    from: vi.fn((table: string) => {
      if (table === 'hari_libur') return hariLiburChain;
      return selectChain;
    }),
    rpc,
    channel: vi.fn(() => channelApi),
    removeChannel: vi.fn().mockResolvedValue('ok'),
    _selectChain: selectChain,
    _hariLiburChain: hariLiburChain,
    _channelApi: channelApi,
    _rpc: rpc,
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
    expect(mock.removeChannel).toHaveBeenCalledWith(mock._channelApi);
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

  it('shows a national holiday banner when hari_libur has today', async () => {
    buildMockSupabase(
      [
        {
          layanan_id: 'l-1',
          layanan_nama: 'Helpdesk OSS',
          tipe: 'konsultatif',
          antre_count: 1,
          dilayani_count: 0,
          estimasi_durasi_menit: 15,
          estimasi_tunggu_total_menit: 15,
        },
      ],
      { holiday: '17 Agustus' },
    );
    render(<EstimasiAntrean />);

    await waitFor(() => {
      expect(screen.getByText(/libur \(17 Agustus\)/i)).toBeInTheDocument();
    });
  });

  it('shows "Tutup hari ini" badge when a layanan is closed per jadwal', async () => {
    buildMockSupabase(
      [
        {
          layanan_id: 'l-1',
          layanan_nama: 'Helpdesk OSS',
          tipe: 'konsultatif',
          antre_count: 3,
          dilayani_count: 1,
          estimasi_durasi_menit: 15,
          estimasi_tunggu_total_menit: 45,
        },
      ],
      { bukaStatus: [false] },
    );
    const { container } = render(<EstimasiAntrean />);

    await waitFor(() => {
      expect(screen.getByText(/Tutup hari ini/i)).toBeInTheDocument();
    });
    const card = container.querySelector('[data-tutup]');
    expect(card).not.toBeNull();
  });

  it('queries hari_libur for today and calls is_layanan_buka_jadwal per loket', async () => {
    const mock = buildMockSupabase([
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
    render(<EstimasiAntrean />);

    await waitFor(() => {
      expect(screen.getByText('Helpdesk OSS')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(mock._hariLiburChain.eq).toHaveBeenCalled();
      expect(mock._rpc).toHaveBeenCalledWith(
        'is_layanan_buka_jadwal',
        expect.objectContaining({ p_layanan_id: 'l-1' }),
      );
    });
  });

  it('does not claim historical accuracy when sample is zero / provisional', async () => {
    buildMockSupabase([
      {
        layanan_id: 'l-1',
        layanan_nama: 'Helpdesk OSS',
        tipe: 'konsultatif',
        antre_count: 2,
        dilayani_count: 0,
        estimasi_durasi_menit: 15,
        estimasi_tunggu_total_menit: 30,
        sample_count: 0,
      } as LoketRow & { sample_count: number },
    ]);
    render(<EstimasiAntrean />);

    await waitFor(() => {
      expect(screen.getByText('Helpdesk OSS')).toBeInTheDocument();
    });
    expect(
      screen.getAllByText(/perkiraan sementara|belum ada data histori|provisional/i).length,
    ).toBeGreaterThan(0);
  });
});
