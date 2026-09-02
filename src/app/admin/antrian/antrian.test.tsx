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

vi.mock('@/components/Pagination', () => ({
  default: () => null,
}));

vi.mock('@/components/WalkinWizard', () => ({
  default: ({ triggerLabel, triggerClassName }: { triggerLabel: string; triggerClassName: string }) => (
    <button type="button" className={triggerClassName}>{triggerLabel}</button>
  ),
}));

// Mock PelayananWizardModal: render teks "Pendataan Pelayanan" saat isOpen=true,
// teks "PendataanClosed" saat isOpen=false. Memudahkan verifikasi auto-open
// tanpa harus mock endpoint /api/admin/pelayanan/[tiketId].
vi.mock('@/components/admin/PelayananWizardModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => (
    <div data-testid="pelayanan-wizard">{isOpen ? 'Pendataan Pelayanan' : 'PendataanClosed'}</div>
  ),
}));

import AntrianPage from './page';
import { createClient } from '@/lib/supabase/client';

// AntrianRow shape matching the component's tiket_antrean query
type AntrianRow = {
  id: string;
  legacy_visit_id: string;
  nomor: number;
  nomor_display: string;
  status: string;
  waktu_terbit: string | null;
  waktu_mulai_layan: string | null;
  waktu_selesai: string | null;
  layanan: { nama: string } | { nama: string }[];
  kunjungan: { nama: string; asal: string; waktu_masuk: string | null } |
    { nama: string; asal: string; waktu_masuk: string | null }[];
};

function buildMock(opts: {
  rows?: AntrianRow[];
  role?: string;
  layananId?: string | null;
} = {}) {
  const rows = opts.rows ?? [];
  const role = opts.role ?? 'admin';
  const layananId = opts.layananId ?? null;

  // Track update calls for assertion
  const updateEq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq: updateEq });

  // tiket_antrean query chain: .select(..., {count}).eq('tanggal',...).order(...).range(...)
  // For admin (no layanan filter): select → eq(tanggal) → order → range
  // The mock must handle both paths.
  const range = vi.fn().mockResolvedValue({ data: rows, count: rows.length });
  const order = vi.fn().mockReturnValue({ range, eq: vi.fn().mockReturnValue({ range }) });
  // tiket_antrean stats query: .select('waktu_mulai_layan, waktu_selesai', {count})
  //   .eq('tanggal').eq('status','selesai')  — directly awaited, no .order()
  const statsEq = vi.fn().mockResolvedValue({ data: rows, count: rows.length });
  const eqTanggal = vi.fn().mockReturnValue({ order, eq: statsEq });
  const tiketSelect = vi.fn().mockReturnValue({ eq: eqTanggal });

  // petugas query chain: .select().eq().single()
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

  // layanan query chain (for WalkinWizard — not exercised here but needed)
  const layananOrder = vi.fn().mockResolvedValue({
    data: [
      { id: 'l-1', nama: 'Helpdesk OSS' },
      { id: 'l-2', nama: 'Layanan Perizinan' },
    ],
    error: null,
  });
  const layananSelect = vi.fn().mockReturnValue({ order: layananOrder });

  // visit table: used for status updates (handleMulaiLayanan / handleSelesaikan)
  const visitInsert = vi.fn().mockResolvedValue({ error: null });
  const visitEq = vi.fn().mockResolvedValue({ error: null });
  const visitUpdate = vi.fn().mockReturnValue({ eq: visitEq });

  const mock = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1' } },
      }),
    },
    from: vi.fn((table: string) => {
      if (table === 'petugas') return { select: petugasSelect };
      if (table === 'tiket_antrean') return { select: tiketSelect };
      if (table === 'visit') return { update: visitUpdate, insert: visitInsert };
      if (table === 'layanan') return { select: layananSelect };
      return {};
    }),
    rpc: vi.fn().mockResolvedValue({ error: null }),
    _update: update,
    _updateEq: updateEq,
    _visitUpdate: visitUpdate,
    _visitEq: visitEq,
  };

  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mock);
  return mock;
}

const baseRow = (over: Partial<AntrianRow> = {}): AntrianRow => ({
  id: 't-1',
  legacy_visit_id: 'v-1',
  nomor: 1,
  nomor_display: 'A-001',
  status: 'menunggu',
  waktu_terbit: new Date().toISOString(),
  waktu_mulai_layan: null,
  waktu_selesai: null,
  layanan: { nama: 'Helpdesk OSS' },
  kunjungan: { nama: 'Budi', asal: 'walk_in', waktu_masuk: new Date().toISOString() },
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
    buildMock({
      rows: [
        baseRow({
          id: 't-walk', legacy_visit_id: 'v-walk', nomor: 1, nomor_display: 'A-001',
          kunjungan: { nama: 'Walk In', asal: 'walk_in', waktu_masuk: new Date().toISOString() },
        }),
        baseRow({
          id: 't-res', legacy_visit_id: 'v-res', nomor: 2, nomor_display: 'A-002',
          kunjungan: { nama: 'Reservasi User', asal: 'reservasi', waktu_masuk: new Date().toISOString() },
        }),
      ],
    });

    render(<AntrianPage />);

    await waitFor(() => {
      expect(screen.getByText('Walk In')).toBeInTheDocument();
    });
    expect(screen.getByText('Reservasi User')).toBeInTheDocument();
  });

  it('shows asal badge for walk_in and reservasi', async () => {
    buildMock({
      rows: [
        baseRow({
          id: 't-walk', legacy_visit_id: 'v-walk', nomor: 1, nomor_display: 'A-001',
          kunjungan: { nama: 'Walk In', asal: 'walk_in', waktu_masuk: new Date().toISOString() },
        }),
        baseRow({
          id: 't-res', legacy_visit_id: 'v-res', nomor: 2, nomor_display: 'A-002',
          kunjungan: { nama: 'Reservasi User', asal: 'reservasi', waktu_masuk: new Date().toISOString() },
        }),
      ],
    });

    render(<AntrianPage />);

    await waitFor(() => {
      // Component renders asalLabel: 'Walk-in' for walk_in, 'Reservasi' for reservasi
      expect(screen.getAllByText(/walk-in/i).length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText(/^Reservasi$/i).length).toBeGreaterThan(0);
  });

  it('Mulai Layanan transitions menunggu → dilayani with waktu_mulai_layan', async () => {
    const mock = buildMock({
      rows: [baseRow({ status: 'menunggu' })],
    });

    render(<AntrianPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /mulai layanan/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /mulai layanan/i }));

    await waitFor(() => {
      expect(mock._visitUpdate).toHaveBeenCalled();
    });

    const payload = mock._visitUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.status).toBe('dilayani');
    expect(typeof payload.waktu_mulai_layan).toBe('string');
    expect(payload.waktu_selesai).toBeUndefined();
  });

  it('Mulai Layanan auto-opens PelayananWizardModal for Helpdesk OSS', async () => {
    buildMock({
      rows: [baseRow({ status: 'menunggu' })],
    });

    render(<AntrianPage />);

    // Sebelum klik: wizard tertutup
    expect(screen.getByTestId('pelayanan-wizard')).toHaveTextContent('PendataanClosed');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /mulai layanan/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /mulai layanan/i }));

    // Setelah klik: wizard harus auto-buka karena Helpdesk OSS layanan pendataan
    await waitFor(() => {
      expect(screen.getByTestId('pelayanan-wizard')).toHaveTextContent('Pendataan Pelayanan');
    });
  });

  it('Mulai Layanan does NOT auto-open wizard for non-pendataan layanan (e.g. P4)', async () => {
    buildMock({
      rows: [baseRow({ status: 'menunggu', layanan: { nama: 'BPJS Kesehatan' } })],
    });

    render(<AntrianPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /mulai layanan/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /mulai layanan/i }));

    // Tunggu fetchData selesai, wizard harus tetap tertutup untuk layanan non-pendataan
    await new Promise(r => setTimeout(r, 50));
    expect(screen.getByTestId('pelayanan-wizard')).toHaveTextContent('PendataanClosed');
  });

  it('Selesai is only available for dilayani and sets waktu_selesai', async () => {
    const mock = buildMock({
      // Non-pendataan layanan so Selesai updates visit directly (pendataan
      // layanan seperti Helpdesk OSS intercepts via PelayananWizardModal).
      rows: [
        baseRow({
          status: 'dilayani',
          layanan: { nama: 'BPJS Kesehatan' },
          waktu_mulai_layan: new Date().toISOString(),
        }),
      ],
    });

    render(<AntrianPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /selesai/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /mulai layanan/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /selesai/i }));

    await waitFor(() => {
      expect(mock._visitUpdate).toHaveBeenCalled();
    });

    const payload = mock._visitUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.status).toBe('selesai');
    expect(typeof payload.waktu_selesai).toBe('string');
    expect(mock._visitEq).toHaveBeenCalledWith('id', 'v-1');
  });

  it('does not offer Selesai directly from menunggu', async () => {
    buildMock({
      rows: [baseRow({ status: 'menunggu' })],
    });

    render(<AntrianPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /mulai layanan/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /^selesai$|selesaikan/i })).not.toBeInTheDocument();
  });
});
