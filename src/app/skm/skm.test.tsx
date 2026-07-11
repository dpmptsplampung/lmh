// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

// Mock next/navigation so useSearchParams returns a controlled token.
const mockSearchParams = vi.fn();
vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams(),
}));

import SkmPage from './page';
import { createClient } from '@/lib/supabase/client';

interface MockOpts {
  visit?: { id: string; layanan_id: string | null; status: string } | null;
  existingSkm?: { id: string } | null;
  token?: string | null;
}

const buildMockSupabase = (opts: MockOpts = {}) => {
  const visitData = opts.visit === undefined ? null : opts.visit;
  const existingData = opts.existingSkm === undefined ? null : opts.existingSkm;

  const visitChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: visitData, error: null }),
  };

  const skmChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: existingData, error: null }),
  };

  const mock = {
    from: vi.fn((table: string) => {
      if (table === 'visit') return visitChain;
      if (table === 'skm_respons') return skmChain;
      return {};
    }),
  };

  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mock);

  // Configure useSearchParams: return a URLSearchParams-like object whose
  // .get('token') returns the configured token (or null).
  const token = opts.token === undefined ? 'valid-token-abc' : opts.token;
  const params = {
    get: (key: string) => (key === 'token' ? token : null),
  };
  mockSearchParams.mockReturnValue(params);

  return { mock, visitChain, skmChain };
};

describe('I3 SKM form: smoke tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the page shell without crashing even before token resolves', async () => {
    buildMockSupabase({ visit: null });
    render(<SkmPage />);

    await waitFor(() => {
      const body = document.body.textContent ?? '';
      expect(body.length).toBeGreaterThan(0);
    });
  });

  it('shows "Token Tidak Valid" when token is missing', async () => {
    buildMockSupabase({ visit: null, token: null });
    render(<SkmPage />);

    await waitFor(() => {
      expect(screen.getByText('Token Tidak Valid')).toBeInTheDocument();
    });
  });

  it('shows "Survei Belum Tersedia" when visit status is not selesai', async () => {
    buildMockSupabase({
      visit: { id: 'v-1', layanan_id: 'l-1', status: 'menunggu' },
    });
    render(<SkmPage />);

    await waitFor(() => {
      expect(screen.getByText('Survei Belum Tersedia')).toBeInTheDocument();
    });
  });

  it('shows already-submitted "Terima Kasih" state when SKM exists', async () => {
    buildMockSupabase({
      visit: { id: 'v-1', layanan_id: 'l-1', status: 'selesai' },
      existingSkm: { id: 'skm-1' },
    });
    render(<SkmPage />);

    await waitFor(() => {
      expect(screen.getByText(/sudah mengisi survei ini/i)).toBeInTheDocument();
    });
  });

  it('renders the 9-unsur form when token valid and visit is selesai', async () => {
    buildMockSupabase({
      visit: { id: 'v-1', layanan_id: 'l-1', status: 'selesai' },
      existingSkm: null,
    });
    render(<SkmPage />);

    await waitFor(() => {
      expect(screen.getByText('U1 Persyaratan')).toBeInTheDocument();
    });

    expect(screen.getByText('U1 Persyaratan')).toBeInTheDocument();
    expect(screen.getByText('U2 Prosedur')).toBeInTheDocument();
    expect(screen.getByText('U3 Waktu')).toBeInTheDocument();
    expect(screen.getByText('U4 Biaya')).toBeInTheDocument();
    expect(screen.getByText('U5 Produk')).toBeInTheDocument();
    expect(screen.getByText('U6 Kompetensi')).toBeInTheDocument();
    expect(screen.getByText('U7 Perilaku')).toBeInTheDocument();
    expect(screen.getByText('U8 Sarana')).toBeInTheDocument();
    expect(screen.getByText('U9 Pengaduan')).toBeInTheDocument();

    const submitBtn = screen.getByRole('button', { name: /kirim survei/i });
    expect(submitBtn).toBeDisabled();
  });
});
