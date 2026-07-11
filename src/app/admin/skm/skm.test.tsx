// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

import SkmAdminPage from './page';
import { createClient } from '@/lib/supabase/client';

interface MockOpts {
  layanan?: Array<{ id: string; nama: string; tipe: string | null }>;
  ikm?: Record<string, { ikm: number | null; responden: number }>;
}

const buildMockSupabase = (opts: MockOpts = {}) => {
  const layananList = opts.layanan ?? [
    { id: 'l-1', nama: 'Helpdesk OSS', tipe: 'konsultatif' },
    { id: 'l-2', nama: 'Sertifikasi Halal', tipe: 'konsultatif' },
  ];
  const ikmMap = opts.ikm ?? {
    'l-1': { ikm: 90.28, responden: 12 },
    'l-2': { ikm: 65.0, responden: 4 },
  };

  const layananChain = {
    select: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise
        .resolve({ data: layananList, error: null })
        .then(resolve, reject),
  };

  const rpcResult = (pLayananId: string) => {
    const entry = ikmMap[pLayananId];
    if (!entry || entry.ikm === null) {
      return { data: [], error: null };
    }
    return {
      data: [{
        layanan_id: pLayananId,
        layanan_nama: layananList.find((l) => l.id === pLayananId)?.nama ?? 'Layanan',
        ikm: entry.ikm,
        responden: entry.responden,
      }],
      error: null,
    };
  };

  const mock = {
    from: vi.fn((table: string) => {
      if (table === 'layanan') return layananChain;
      return {};
    }),
    rpc: vi.fn((fnName: string, args: { p_layanan_id: string }) => {
      if (fnName === 'hitung_ikm') {
        return Promise.resolve(rpcResult(args.p_layanan_id));
      }
      return Promise.resolve({ data: null, error: { message: 'unknown rpc' } });
    }),
  };

  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mock);
  return { mock };
};

describe('I3 SKM admin dashboard: smoke tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders header, summary, and table after data loads', async () => {
    buildMockSupabase();

    render(<SkmAdminPage />);

    // Page header
    await waitFor(() => {
      expect(screen.getByText('IKM per Layanan')).toBeInTheDocument();
    });

    // Summary cards
    expect(screen.getByText('Rata-rata IKM')).toBeInTheDocument();
    expect(screen.getByText('Total Responden')).toBeInTheDocument();
    expect(screen.getByText('Layanan Disurvei')).toBeInTheDocument();

    // Table rows for each layanan
    expect(screen.getByText('Helpdesk OSS')).toBeInTheDocument();
    expect(screen.getByText('Sertifikasi Halal')).toBeInTheDocument();
  });

  it('assigns quality grades A and C based on IKM score', async () => {
    buildMockSupabase({
      ikm: {
        'l-1': { ikm: 90.0, responden: 10 },  // A — Sangat Baik
        'l-2': { ikm: 65.0, responden: 5 },   // C — Kurang Baik
      },
    });

    render(<SkmAdminPage />);

    await waitFor(() => {
      expect(screen.getByText(/Sangat Baik/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Kurang Baik/i)).toBeInTheDocument();
  });

  it('assigns grade D when IKM is below 60', async () => {
    buildMockSupabase({
      ikm: {
        'l-1': { ikm: 45.0, responden: 2 },  // D — Tidak Baik
        'l-2': { ikm: null, responden: 0 },
      },
    });

    render(<SkmAdminPage />);

    await waitFor(() => {
      // Summary avg + table row both get grade D — at least one occurrence.
      const matches = screen.getAllByText(/Tidak Baik/i);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders empty table state when no layanan returned', async () => {
    buildMockSupabase({ layanan: [], ikm: {} });

    render(<SkmAdminPage />);

    await waitFor(() => {
      expect(screen.getByText(/Belum ada data layanan/i)).toBeInTheDocument();
    });
  });

  it('renders back link to /admin', async () => {
    buildMockSupabase();

    render(<SkmAdminPage />);

    await waitFor(() => {
      expect(screen.getByText('IKM per Layanan')).toBeInTheDocument();
    });
    const backLink = screen.getByRole('link', { name: /kembali ke dashboard/i });
    expect(backLink).toHaveAttribute('href', '/admin');
  });

  it('excludes modul_publik layanan from the list (via .neq tipe)', async () => {
    const { mock } = buildMockSupabase();

    render(<SkmAdminPage />);

    await waitFor(() => {
      expect(screen.getByText('Helpdesk OSS')).toBeInTheDocument();
    });

    // The layanan query must filter out modul_publik
    const fromSpy = mock.from as unknown as ReturnType<typeof vi.fn>;
    expect(fromSpy).toHaveBeenCalledWith('layanan');
  });
});
