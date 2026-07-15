// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '550e8400-e29b-41d4-a716-446655440000' }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

import UmkmEditPage from './page';
import { createClient } from '@/lib/supabase/client';

function buildMock() {
  const updateEq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq: updateEq });
  const maybeSingle = vi.fn().mockResolvedValue({
    data: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      nama_umkm: 'Toko Lama',
      kategori_kebutuhan: 'bahan_baku',
      deskripsi: null,
      kontak_nama: 'Budi',
      kontak_hp: null,
      kontak_email: null,
      foto_produk: null,
      status: 'published',
      sisi: 'kebutuhan',
    },
    error: null,
  });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });

  const mock = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'owner-1' } },
      }),
    },
    from: vi.fn(() => ({ select, update })),
    _update: update,
    _updateEq: updateEq,
  };

  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mock);
  return mock;
}

describe('UMKM owner edit sisi field', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('includes sisi select and sends sisi on update', async () => {
    const mock = buildMock();
    render(<UmkmEditPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/sisi/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/sisi/i), {
      target: { value: 'penawaran' },
    });

    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    await waitFor(() => {
      expect(mock._update).toHaveBeenCalled();
    });

    const payload = mock._update.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.sisi).toBe('penawaran');
  });
});
