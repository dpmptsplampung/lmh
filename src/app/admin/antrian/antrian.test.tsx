// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/components/layout/PageHeader', () => ({
  default: ({ title, children }: { title: string; children?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

import AntrianPage from './page';
import { createClient } from '@/lib/supabase/client';

type VisitRow = {
  id: string;
  nama: string;
  keperluan: string;
  status: string;
  asal: string;
  waktu_masuk: string;
  waktu_selesai: string | null;
  waktu_mulai_layan?: string | null;
  layanan: { nama: string } | { nama: string }[];
};

function buildMock(opts: {
  visits?: VisitRow[];
  role?: string;
  layananId?: string | null;
} = {}) {
  const visits = opts.visits ?? [];
  const role = opts.role ?? 'admin';
  const layananId = opts.layananId ?? null;

  const updateEq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq: updateEq });

  const order = vi.fn().mockResolvedValue({ data: visits, error: null });
  const lte = vi.fn().mockReturnValue({ order });
  const gte = vi.fn().mockReturnValue({ lte });
  const inFilter = vi.fn().mockReturnValue({ gte });
  const eq = vi.fn().mockImplementation((col: string) => {
    if (col === 'layanan_id') return { gte };
    return { gte };
  });
  const select = vi.fn().mockReturnValue({ eq, in: inFilter, gte });

  const petugasSingle = vi.fn().mockResolvedValue({
    data: role === 'admin' && !opts.layananId
      ? null
      : {
          id: 'p-1',
          role,
          layanan_id: layananId,
          layanan: { nama: 'Helpdesk OSS' },
        },
    error: null,
  });
  const petugasEq = vi.fn().mockReturnValue({ single: petugasSingle });
  const petugasSelect = vi.fn().mockReturnValue({ eq: petugasEq });

  const mock = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1' } },
      }),
    },
    from: vi.fn((table: string) => {
      if (table === 'petugas') return { select: petugasSelect };
      if (table === 'visit') return { select, update };
      return {};
    }),
    _select: select,
    _eq: eq,
    _in: inFilter,
    _update: update,
    _updateEq: updateEq,
  };

  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mock);
  return mock;
}

const baseVisit = (over: Partial<VisitRow> = {}): VisitRow => ({
  id: 'v-1',
  nama: 'Budi',
  keperluan: 'OSS',
  status: 'menunggu',
  asal: 'walk_in',
  waktu_masuk: new Date().toISOString(),
  waktu_selesai: null,
  layanan: { nama: 'Helpdesk OSS' },
  ...over,
});

describe('Admin antrian operational lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('loads walk_in and reservasi (does not filter asal=walk_in only)', async () => {
    const mock = buildMock({
      visits: [
        baseVisit({ id: 'v-walk', asal: 'walk_in', nama: 'Walk In' }),
        baseVisit({ id: 'v-res', asal: 'reservasi', nama: 'Reservasi User', status: 'menunggu' }),
      ],
    });

    render(<AntrianPage />);

    await waitFor(() => {
      expect(screen.getByText('Walk In')).toBeInTheDocument();
    });
    expect(screen.getByText('Reservasi User')).toBeInTheDocument();

    // Must not restrict operational queue to walk_in only
    expect(mock._eq).not.toHaveBeenCalledWith('asal', 'walk_in');
  });

  it('shows asal badge for walk_in and reservasi', async () => {
    buildMock({
      visits: [
        baseVisit({ id: 'v-walk', asal: 'walk_in', nama: 'Walk In' }),
        baseVisit({ id: 'v-res', asal: 'reservasi', nama: 'Reservasi User' }),
      ],
    });

    render(<AntrianPage />);

    await waitFor(() => {
      expect(screen.getAllByText(/walk-in/i).length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText(/^reservasi$/i).length).toBeGreaterThan(0);
  });

  it('Mulai Layanan transitions menunggu → dilayani with waktu_mulai_layan', async () => {
    const mock = buildMock({
      visits: [baseVisit({ status: 'menunggu' })],
    });

    render(<AntrianPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /mulai layanan/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /mulai layanan/i }));

    await waitFor(() => {
      expect(mock._update).toHaveBeenCalled();
    });

    const payload = mock._update.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.status).toBe('dilayani');
    expect(typeof payload.waktu_mulai_layan).toBe('string');
    expect(payload.waktu_selesai).toBeUndefined();
  });

  it('Selesai is only available for dilayani and sets waktu_selesai', async () => {
    const mock = buildMock({
      visits: [baseVisit({ status: 'dilayani', waktu_mulai_layan: new Date().toISOString() })],
    });

    render(<AntrianPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /selesai/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /mulai layanan/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /selesai/i }));

    await waitFor(() => {
      expect(mock._update).toHaveBeenCalled();
    });

    const payload = mock._update.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.status).toBe('selesai');
    expect(typeof payload.waktu_selesai).toBe('string');
  });

  it('does not offer Selesai directly from menunggu', async () => {
    buildMock({
      visits: [baseVisit({ status: 'menunggu' })],
    });

    render(<AntrianPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /mulai layanan/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /^selesai$|selesaikan/i })).not.toBeInTheDocument();
  });
});
