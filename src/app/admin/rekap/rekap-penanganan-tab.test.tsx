// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('@/components/admin/RekapLayananTable', () => ({ default: () => <div /> }));
vi.mock('@/components/admin/RekapPenangananTable', () => ({
  default: ({ peran, isPetugas, initialLayananId }: { peran: string; isPetugas: boolean; initialLayananId: string | null }) => (
    <div data-testid="penanganan">{`peran=${peran};isPetugas=${isPetugas};layanan=${initialLayananId ?? 'null'}`}</div>
  ),
}));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/layout/PageHeader', () => ({
  default: ({ title, children }: { title: string; children?: React.ReactNode }) => (
    <div><h1>{title}</h1>{children}</div>
  ),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    const b: Record<string, unknown> = {};
    for (const m of ['from', 'select', 'eq', 'gte', 'lte', 'order']) b[m] = () => b;
    b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
    return b;
  },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import AdminRekapPage from './page';

function layananOptions(body: Record<string, unknown>) {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ options: [], default_layanan_id: null, is_petugas: false, ...body }) });
}

describe('/admin/rekap: tab Rekap Petugas Layanan', () => {
  beforeEach(() => mockFetch.mockReset());
  afterEach(() => cleanup());

  it('Admin melihat tab dan isinya memakai peran layanan', async () => {
    layananOptions({ role: 'admin' });
    render(<AdminRekapPage />);
    const tab = await screen.findByRole('button', { name: /rekap petugas layanan/i });
    fireEvent.click(tab);
    expect(await screen.findByTestId('penanganan')).toHaveTextContent('peran=layanan');
  });

  it('Petugas: layanan dikunci diteruskan ke tab', async () => {
    layananOptions({ role: 'petugas', is_petugas: true, default_layanan_id: 'l1' });
    render(<AdminRekapPage />);
    fireEvent.click(await screen.findByRole('button', { name: /rekap petugas layanan/i }));
    expect(await screen.findByTestId('penanganan')).toHaveTextContent('isPetugas=true;layanan=l1');
  });

  it('Front Office tidak melihat tab (hanya Admin dan Petugas)', async () => {
    layananOptions({ role: 'front_office' });
    render(<AdminRekapPage />);
    await screen.findByRole('button', { name: /rekap per layanan/i });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('button', { name: /rekap petugas layanan/i })).not.toBeInTheDocument();
  });

  it('tab Rekap Umum memuat catatan bahwa Hadir tidak menghitung tiket dialihkan', async () => {
    layananOptions({ role: 'admin' });
    render(<AdminRekapPage />);
    expect(await screen.findByText(/tidak menghitung tiket yang dialihkan/i)).toBeInTheDocument();
  });
});
