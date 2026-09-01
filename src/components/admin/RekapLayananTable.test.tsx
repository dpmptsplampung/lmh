// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import RekapLayananTable from './RekapLayananTable';

const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock('@/components/Pagination', () => ({
  default: ({ onPageChange }: { onPageChange: (p: number) => void }) => (
    <div>
      <button onClick={() => onPageChange(1)}>next-page</button>
    </div>
  ),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const sampleRow = {
  id: 't-1',
  nomor_display: 'A-001',
  tanggal: '2026-08-31',
  waktu_terbit: '2026-08-31T01:00:00Z',
  waktu_mulai_layan: '2026-08-31T01:05:00Z',
  waktu_selesai: '2026-08-31T01:20:00Z',
  status: 'selesai',
  kunjungan: { nama: 'Budi', asal: 'walk_in', qr_token: null },
  petugas: { nama: 'Andi' },
  form_type: null,
  pelayanan_oss: null,
  pelayanan_perizinAN: null,
};

describe('RekapLayananTable', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ total: 1, rows: [sampleRow] }),
    });
  });
  afterEach(() => cleanup());

  it('renders filter form and initial fetch', async () => {
    render(<RekapLayananTable isPetugas={false} initialLayananId={null} options={[]} />);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  it('shows empty state when total is 0', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ total: 0, rows: [] }),
    });
    render(<RekapLayananTable isPetugas={false} initialLayananId={null} options={[]} />);
    await waitFor(() => {
      expect(screen.getByText(/tidak ada tiket selesai/i)).toBeInTheDocument();
    });
  });

  it('renders rows with formatted fields', async () => {
    render(<RekapLayananTable isPetugas={false} initialLayananId={null} options={[]} />);
    await waitFor(() => {
      expect(screen.getByText(/A-001/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Budi/)).toBeInTheDocument();
    expect(screen.getByText(/Andi/)).toBeInTheDocument();
  });

  it('disables export when no rows', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ total: 0, rows: [] }),
    });
    render(<RekapLayananTable isPetugas={false} initialLayananId={null} options={[]} />);
    await waitFor(() => {
      const exportBtn = screen.getByRole('button', { name: /download excel/i });
      expect(exportBtn).toBeDisabled();
    });
  });

  it('shows error state on fetch failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Server error' }),
    });
    render(<RekapLayananTable isPetugas={false} initialLayananId={null} options={[]} />);
    await waitFor(() => {
      expect(screen.getByText(/coba lagi/i)).toBeInTheDocument();
    });
  });

  it('opens detail panel on row click', async () => {
    render(<RekapLayananTable isPetugas={false} initialLayananId={null} options={[]} />);
    await waitFor(() => {
      expect(screen.getByText(/A-001/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /lihat detail/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
