// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

const toastMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ toast: toastMock }),
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

type DbError = { message: string; code?: string };

function buildMock(opts: {
  rows?: AntrianRow[];
  role?: string;
  layananId?: string | null;
  // Hasil UPDATE visit (setelah .select('id')): baris terdampak / error PostgREST.
  visitResult?: { data: { id: string }[] | null; error: DbError | null };
  // Hasil RPC panggil_tiket: data = nomor_display, atau null bila tiket bukan 'menunggu'.
  panggilResult?: { data: string | null; error: DbError | null };
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
  // UPDATE visit kini berakhir .select('id') agar baris terdampak terlihat (mutasiWajibBaris).
  const visitSelect = vi
    .fn()
    .mockResolvedValue(opts.visitResult ?? { data: [{ id: 'v-1' }], error: null });
  const visitEq = vi.fn().mockReturnValue({ select: visitSelect });
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
    rpc: vi.fn().mockResolvedValue(opts.panggilResult ?? { data: 'A-001', error: null }),
    _update: update,
    _updateEq: updateEq,
    _visitUpdate: visitUpdate,
    _visitEq: visitEq,
    _visitSelect: visitSelect,
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
    toastMock.mockClear();
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

  describe('Koreksi data terkunci', () => {
    const selesai = () =>
      baseRow({ status: 'selesai', waktu_mulai_layan: new Date().toISOString(), waktu_selesai: new Date().toISOString() });

    it('Front Office melihat tombol Koreksi Data pada tiket selesai', async () => {
      buildMock({ rows: [selesai()], role: 'front_office' });
      render(<AntrianPage />);
      expect(await screen.findByRole('button', { name: /Koreksi Data/i })).toBeInTheDocument();
    });

    it('Admin melihat tombol Koreksi Data', async () => {
      buildMock({ rows: [selesai()], role: 'admin', layananId: 'l-1' });
      render(<AntrianPage />);
      expect(await screen.findByRole('button', { name: /Koreksi Data/i })).toBeInTheDocument();
    });

    it('Petugas tidak melihat tombol; hanya teks data terkunci', async () => {
      buildMock({ rows: [selesai()], role: 'petugas', layananId: 'l-1' });
      render(<AntrianPage />);
      expect(
        await screen.findByText(/Data sudah dikunci\. Hubungi Front Office atau Admin untuk koreksi\./i),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Koreksi Data/i })).not.toBeInTheDocument();
    });

    it('tiket belum selesai tidak punya tombol koreksi', async () => {
      buildMock({ rows: [baseRow({ status: 'dilayani' })], role: 'front_office' });
      render(<AntrianPage />);
      await screen.findByText('Budi');
      expect(screen.queryByRole('button', { name: /Koreksi Data/i })).not.toBeInTheDocument();
    });
  });
});

describe('Admin antrian: mutasi dicek (tidak ada sukses palsu)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toastMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  const pesanDipanggil = (n: string) => expect.stringContaining(`Memanggil ${n}`);

  it('Mulai Layanan: 0 baris terdampak (RLS menolak diam-diam) -> toast gagal, wizard TIDAK terbuka, tanpa toast sukses', async () => {
    buildMock({ rows: [baseRow({ status: 'menunggu' })], visitResult: { data: [], error: null } });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /mulai layanan/i }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('Gagal memulai layanan'), 'error'),
    );
    expect(toastMock).not.toHaveBeenCalledWith('Layanan dimulai', 'success');
    expect(screen.getByTestId('pelayanan-wizard')).toHaveTextContent('PendataanClosed');
  });

  it('Mulai Layanan: error dari DB -> toast gagal, bukan sukses', async () => {
    buildMock({
      rows: [baseRow({ status: 'menunggu' })],
      visitResult: { data: null, error: { message: 'boom', code: 'XX000' } },
    });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /mulai layanan/i }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('Gagal memulai layanan'), 'error'),
    );
    expect(toastMock).not.toHaveBeenCalledWith('Layanan dimulai', 'success');
  });

  it('Mulai Layanan: ditolak/0 baris -> daftar dimuat ulang (tampilan kemungkinan basi)', async () => {
    const mock = buildMock({ rows: [baseRow({ status: 'menunggu' })], visitResult: { data: [], error: null } });
    render(<AntrianPage />);
    await screen.findByRole('button', { name: /mulai layanan/i });
    const sebelum = mock.from.mock.calls.filter(([t]) => t === 'tiket_antrean').length;
    fireEvent.click(screen.getByRole('button', { name: /mulai layanan/i }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('Gagal memulai layanan'), 'error'),
    );
    await waitFor(() =>
      expect(mock.from.mock.calls.filter(([t]) => t === 'tiket_antrean').length).toBeGreaterThan(sebelum),
    );
    expect(toastMock).not.toHaveBeenCalledWith('Layanan dimulai', 'success');
  });

  it('Mulai Layanan: berhasil (baris terbukti) -> toast sukses', async () => {
    buildMock({ rows: [baseRow({ status: 'menunggu' })] });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /mulai layanan/i }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('Layanan dimulai', 'success'));
  });

  it('Selesai: 0 baris terdampak -> toast gagal, tanpa toast sukses', async () => {
    buildMock({
      rows: [baseRow({ status: 'dilayani', layanan: { nama: 'BPJS Kesehatan' } })],
      visitResult: { data: [], error: null },
    });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /selesai/i }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('Gagal menyelesaikan antrian'), 'error'),
    );
    expect(toastMock).not.toHaveBeenCalledWith('Kunjungan berhasil diselesaikan', 'success');
  });

  it('Selesai: berhasil -> toast sukses', async () => {
    buildMock({ rows: [baseRow({ status: 'dilayani', layanan: { nama: 'BPJS Kesehatan' } })] });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /selesai/i }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('Kunjungan berhasil diselesaikan', 'success'));
  });

  it('Panggil: tiket bukan "menunggu" (RPC mengembalikan NULL tanpa error) -> BUKAN "Memanggil ...", toast gagal', async () => {
    const mock = buildMock({
      rows: [baseRow({ status: 'menunggu' })],
      panggilResult: { data: null, error: null },
    });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /^panggil$/i }));

    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith('panggil_tiket', { p_tiket_id: 't-1' }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('A-001'), 'error'));
    expect(toastMock).not.toHaveBeenCalledWith(pesanDipanggil('A-001'), 'success');
  });

  it('Panggil: RPC error (42501, bukan layanan Anda) -> toast gagal, bukan sukses', async () => {
    buildMock({
      rows: [baseRow({ status: 'menunggu' })],
      panggilResult: { data: null, error: { message: 'tiket bukan milik layanan Anda', code: '42501' } },
    });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /^panggil$/i }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('Gagal memanggil A-001'), 'error'),
    );
    expect(toastMock).not.toHaveBeenCalledWith(pesanDipanggil('A-001'), 'success');
  });

  it('Panggil: berhasil (RPC mengembalikan nomor) -> toast "Memanggil ..."', async () => {
    buildMock({ rows: [baseRow({ status: 'menunggu' })] });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /^panggil$/i }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(pesanDipanggil('A-001'), 'success'));
  });
});
