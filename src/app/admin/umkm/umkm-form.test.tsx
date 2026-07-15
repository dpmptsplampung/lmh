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

vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element -- test mock for next/image
  default: (props: { alt?: string }) => <img alt={props.alt ?? ''} />,
}));

import AdminUMKMPage from './page';
import { createClient } from '@/lib/supabase/client';

function buildMock() {
  const order = vi.fn().mockResolvedValue({ data: [], error: null });
  const select = vi.fn().mockReturnValue({ order });
  const insert = vi.fn().mockResolvedValue({ error: null });
  const updateEq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq: updateEq });

  const mock = {
    from: vi.fn(() => ({
      select,
      insert,
      update,
      delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
    })),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'http://x/y.jpg' } }),
      })),
    },
    _insert: insert,
    _update: update,
  };

  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mock);
  return mock;
}

describe('Admin UMKM sisi field', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('create form includes sisi select and sends sisi in insert payload', async () => {
    const mock = buildMock();
    render(<AdminUMKMPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /tambah umkm/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /tambah umkm/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/sisi/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/nama umkm/i), {
      target: { value: 'Toko Sejahtera' },
    });
    fireEvent.change(screen.getByLabelText(/kategori/i), {
      target: { value: 'bahan_baku' },
    });
    fireEvent.change(screen.getByLabelText(/^sisi/i), {
      target: { value: 'penawaran' },
    });
    fireEvent.change(screen.getByLabelText(/nama kontak/i), {
      target: { value: 'Siti' },
    });

    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    await waitFor(() => {
      expect(mock._insert).toHaveBeenCalled();
    });

    const payload = mock._insert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.sisi).toBe('penawaran');
  });
});
