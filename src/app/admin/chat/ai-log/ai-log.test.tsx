// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

import AdminAiLogPage from './page';
import { createClient } from '@/lib/supabase/client';

interface MockOpts {
  rows?: unknown[];
  error?: { message: string } | null;
}

const buildMockSupabase = (opts: MockOpts = {}) => {
  const rows = opts.rows ?? [];
  const mock = {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        order: vi.fn(() => ({
          limit: vi.fn(async () => ({
            data: rows,
            error: opts.error ?? null,
          })),
        })),
      })),
    })),
  };
  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mock);
  return mock;
};

describe('I4: Admin AI log page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = vi.fn();
    }
  });

  afterEach(() => {
    cleanup();
  });

  it('renders loading state initially, then rows', async () => {
    buildMockSupabase({
      rows: [
        {
          id: 'log-1',
          sesi_id: 'sesi-1',
          pertanyaan: 'Apa syarat NIB?',
          context_faq_ids: ['f-1'],
          jawaban: 'KTP dan NPWP [1]',
          top_similarity: 0.92,
          eskalasi: false,
          reason: null,
          created_at: '2026-07-11T08:00:00Z',
        },
      ],
    });

    render(<AdminAiLogPage />);

    await waitFor(() => {
      expect(screen.getByText('Apa syarat NIB?')).toBeInTheDocument();
    });
    expect(screen.getByText('0.920')).toBeInTheDocument();
    expect(screen.getByText(/Terjawab/i)).toBeInTheDocument();
  });

  it('shows eskalasi badge for eskalasi rows', async () => {
    buildMockSupabase({
      rows: [
        {
          id: 'log-2',
          sesi_id: 'sesi-2',
          pertanyaan: 'Pertanyaan tidak jelas',
          context_faq_ids: [],
          jawaban: null,
          top_similarity: 0.3,
          eskalasi: true,
          reason: 'no_match',
          created_at: '2026-07-11T08:00:00Z',
        },
      ],
    });

    render(<AdminAiLogPage />);

    await waitFor(() => {
      expect(screen.getByText('Pertanyaan tidak jelas')).toBeInTheDocument();
    });
    expect(screen.getByText(/Tidak ada match FAQ/i)).toBeInTheDocument();
  });

  it('shows error state when fetch fails', async () => {
    buildMockSupabase({ error: { message: 'rls denied' } });

    render(<AdminAiLogPage />);

    await waitFor(() => {
      expect(screen.getByText(/Gagal memuat log AI/i)).toBeInTheDocument();
    });
  });

  it('shows empty state when no rows', async () => {
    buildMockSupabase({ rows: [] });

    render(<AdminAiLogPage />);

    await waitFor(() => {
      expect(
        screen.getByText(/Belum ada log asisten AI/i),
      ).toBeInTheDocument();
    });
  });

  it('filter dropdown switches to eskalasi-only view', async () => {
    buildMockSupabase({
      rows: [
        {
          id: 'log-a',
          sesi_id: null,
          pertanyaan: 'Pertanyaan terjawab',
          context_faq_ids: ['f-1'],
          jawaban: 'Jawaban [1]',
          top_similarity: 0.95,
          eskalasi: false,
          reason: null,
          created_at: '2026-07-11T08:00:00Z',
        },
        {
          id: 'log-b',
          sesi_id: null,
          pertanyaan: 'Pertanyaan dieskalasi',
          context_faq_ids: [],
          jawaban: null,
          top_similarity: 0.4,
          eskalasi: true,
          reason: 'no_match',
          created_at: '2026-07-11T09:00:00Z',
        },
      ],
    });

    render(<AdminAiLogPage />);

    await waitFor(() => {
      expect(screen.getByText('Pertanyaan terjawab')).toBeInTheDocument();
      expect(screen.getByText('Pertanyaan dieskalasi')).toBeInTheDocument();
    });

    // Switch filter to eskalasi only
    const select = screen.getByDisplayValue(/Semua/i);
    fireEvent.change(select, { target: { value: 'eskalasi' } });

    await waitFor(() => {
      expect(screen.queryByText('Pertanyaan terjawab')).not.toBeInTheDocument();
      expect(screen.getByText('Pertanyaan dieskalasi')).toBeInTheDocument();
    });
  });

  it('Tambah ke FAQ link encodes the pertanyaan in query param', async () => {
    buildMockSupabase({
      rows: [
        {
          id: 'log-3',
          sesi_id: null,
          pertanyaan: 'Bagaimana cara daftar OSS?',
          context_faq_ids: [],
          jawaban: null,
          top_similarity: 0.5,
          eskalasi: true,
          reason: 'no_match',
          created_at: '2026-07-11T08:00:00Z',
        },
      ],
    });

    render(<AdminAiLogPage />);

    await waitFor(() => {
      expect(screen.getByText(/Tambah ke FAQ/i)).toBeInTheDocument();
    });

    const link = screen.getByRole('link', { name: /Tambah ke FAQ/i });
    expect(link.getAttribute('href')).toContain(
      'prefill_pertanyaan=Bagaimana%20cara%20daftar%20OSS%3F',
    );
  });
});
