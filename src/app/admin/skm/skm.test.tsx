// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

import SkmAdminPage from './page';
import { createClient } from '@/lib/supabase/client';
import { PERTANYAAN_SPAK } from '@/lib/survei/pertanyaan';

type Role = 'admin' | 'front_office' | 'petugas';

interface IkmBaris {
  layanan_id: string | null;
  unit: 'layanan' | 'fo' | 'tidak_diketahui';
  nama: string;
  ikm: number | null;
  responden: number;
}

interface MockOpts {
  role?: Role | null;
  ikm?: IkmBaris[];
  spak?: Array<Record<string, unknown>>;
  petugasLayananId?: string;
}

const IKM_DEFAULT: IkmBaris[] = [
  { layanan_id: 'l-1', unit: 'layanan', nama: 'Helpdesk OSS', ikm: 90.28, responden: 12 },
  { layanan_id: 'l-2', unit: 'layanan', nama: 'Sertifikasi Halal', ikm: 65.0, responden: 4 },
];

const buildMockSupabase = (opts: MockOpts = {}) => {
  const role = opts.role === undefined ? 'admin' : opts.role;
  const ikm = opts.ikm ?? IKM_DEFAULT;

  const petugasChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: role
        ? {
            role,
            layanan_id: opts.petugasLayananId ?? null,
            layanan: role === 'petugas' ? { nama: 'Helpdesk OSS' } : null,
          }
        : null,
      error: null,
    }),
  };

  const mock = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-1' } } }) },
    from: vi.fn((table: string) => (table === 'petugas' ? petugasChain : {})),
    rpc: vi.fn((fnName: string) => {
      if (fnName === 'ringkasan_ikm') return Promise.resolve({ data: ikm, error: null });
      if (fnName === 'ringkasan_spak') return Promise.resolve({ data: opts.spak ?? [], error: null });
      return Promise.resolve({ data: null, error: { message: 'unknown rpc' } });
    }),
  };

  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mock);
  return { mock };
};

const pemanggilan = (mock: ReturnType<typeof buildMockSupabase>['mock'], nama: string) =>
  (mock.rpc as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === nama);

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

    await waitFor(() => {
      expect(screen.getByText('IKM per Layanan')).toBeInTheDocument();
    });

    expect(screen.getByText('Rata-rata IKM')).toBeInTheDocument();
    expect(screen.getByText('Total Responden')).toBeInTheDocument();
    expect(screen.getByText('Layanan Disurvei')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Helpdesk OSS')).toBeInTheDocument();
    });
    expect(screen.getByText('Sertifikasi Halal')).toBeInTheDocument();
  });

  it('assigns quality grades A and C based on IKM score', async () => {
    buildMockSupabase({
      ikm: [
        { layanan_id: 'l-1', unit: 'layanan', nama: 'Helpdesk OSS', ikm: 90.0, responden: 10 }, // A
        { layanan_id: 'l-2', unit: 'layanan', nama: 'Sertifikasi Halal', ikm: 65.0, responden: 5 }, // C
      ],
    });

    render(<SkmAdminPage />);

    await waitFor(() => {
      expect(screen.getByText(/Sangat Baik/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Kurang Baik/i)).toBeInTheDocument();
  });

  it('assigns grade D when IKM is below 60', async () => {
    buildMockSupabase({
      ikm: [
        { layanan_id: 'l-1', unit: 'layanan', nama: 'Helpdesk OSS', ikm: 45.0, responden: 2 },
        { layanan_id: 'l-2', unit: 'layanan', nama: 'Sertifikasi Halal', ikm: null, responden: 0 },
      ],
    });

    render(<SkmAdminPage />);

    await waitFor(() => {
      const matches = screen.getAllByText(/Tidak Baik/i);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders empty table state when no data returned', async () => {
    buildMockSupabase({ ikm: [] });

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
});

describe('Task 12: ringkasan IKM satu panggilan, tab SPAK, unduhan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('memanggil ringkasan_ikm sekali (bukan hitung_ikm per layanan) dan menampilkan baris Front Office dan tidak terklasifikasi', async () => {
    const { mock } = buildMockSupabase({
      ikm: [
        ...IKM_DEFAULT,
        { layanan_id: null, unit: 'fo', nama: 'Front Office', ikm: 80, responden: 7 },
        { layanan_id: null, unit: 'tidak_diketahui', nama: 'Tidak terklasifikasi (data lama/impor)', ikm: 70, responden: 30 },
      ],
    });

    render(<SkmAdminPage />);

    await waitFor(() => {
      expect(screen.getByText('Front Office')).toBeInTheDocument();
    });
    expect(screen.getByText('Tidak terklasifikasi (data lama/impor)')).toBeInTheDocument();
    expect(pemanggilan(mock, 'ringkasan_ikm')).toHaveLength(1);
    expect(pemanggilan(mock, 'hitung_ikm')).toHaveLength(0);

    const [, args] = pemanggilan(mock, 'ringkasan_ikm')[0];
    expect(args.p_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(args.p_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it.each<Role>(['admin', 'front_office'])('peran %s melihat tab SPAK dan tombol Unduh sesuai periode', async (role) => {
    buildMockSupabase({ role });

    render(<SkmAdminPage />);

    const unduh = await screen.findByRole('link', { name: /unduh/i });
    expect(unduh.getAttribute('href')).toMatch(
      /^\/api\/admin\/survei\/export\?dari=\d{4}-\d{2}-\d{2}&sampai=\d{4}-\d{2}-\d{2}$/,
    );
    expect(screen.getByRole('tab', { name: 'SPAK' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'IKM' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.change(screen.getByLabelText('Pilih periode'), { target: { value: 'year' } });
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /unduh/i }).getAttribute('href')).toMatch(/dari=\d{4}-01-01&/);
    });
  });

  it('peran petugas tidak melihat tab SPAK maupun Unduh, hanya IKM layanannya, dan RoleNote tetap tampil', async () => {
    const { mock } = buildMockSupabase({ role: 'petugas', petugasLayananId: 'l-1' });

    render(<SkmAdminPage />);

    await waitFor(() => {
      expect(screen.getByText(/Data ini hanya untuk layanan Helpdesk OSS/)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('Helpdesk OSS')).toBeInTheDocument();
    });
    expect(screen.queryByText('Sertifikasi Halal')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'SPAK' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /unduh/i })).not.toBeInTheDocument();
    expect(pemanggilan(mock, 'ringkasan_spak')).toHaveLength(0);
  });

  it('membuka tab SPAK memuat ringkasan_spak dan menampilkan kelima pernyataan', async () => {
    const { mock } = buildMockSupabase({
      role: 'admin',
      spak: [
        { layanan_id: 'l-1', unit: 'layanan', nama: 'Helpdesk OSS', responden: 3, p1: 5.5, p2: 4, p3: 3, p4: 2, p5: 1 },
      ],
    });

    render(<SkmAdminPage />);

    fireEvent.click(await screen.findByRole('tab', { name: 'SPAK' }));

    await waitFor(() => {
      expect(screen.getByText(PERTANYAAN_SPAK[0].teks)).toBeInTheDocument();
    });
    for (const p of PERTANYAAN_SPAK) {
      expect(screen.getByText(p.teks)).toBeInTheDocument();
    }
    expect(pemanggilan(mock, 'ringkasan_spak')).toHaveLength(1);
    expect(screen.getByRole('row', { name: /Helpdesk OSS/ })).toBeInTheDocument();
  });

  it('galat memuat SPAK menampilkan pesan, bukan tabel kosong', async () => {
    const { mock } = buildMockSupabase({ role: 'admin' });
    (mock.rpc as unknown as ReturnType<typeof vi.fn>).mockImplementation((fn: string) =>
      Promise.resolve(
        fn === 'ringkasan_spak'
          ? { data: null, error: { message: 'boom' } }
          : { data: IKM_DEFAULT, error: null },
      ),
    );
    const galat = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<SkmAdminPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'SPAK' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Gagal memuat data SPAK/);
    });
    expect(screen.queryByText(/Belum ada data SPAK/i)).not.toBeInTheDocument();
    galat.mockRestore();
  });
});
