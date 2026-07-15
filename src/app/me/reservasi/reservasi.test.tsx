// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('@/components/QRCode', () => ({ default: () => <div>QR</div> }));

import { createClient } from '@/lib/supabase/client';
import ReservasiPage from './page';

describe('reservation payload', () => {
  const insert = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    insert.mockImplementation((payload: unknown) => ({
      select: () => ({
        single: async () => ({ data: { qr_token: 'qr-token' }, error: null }),
      }),
      payload,
    }));

    const layanan = {
      select: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const pengunjung = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'visitor-1', nama: 'Nama Kanonis' },
        error: null,
      }),
    };
    const visit = { insert };

    (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'auth-1' } } }) },
      from: vi.fn((table: string) => {
        if (table === 'pengunjung') return pengunjung;
        if (table === 'layanan') return layanan;
        if (table === 'visit') return visit;
        return {};
      }),
    });
  });

  afterEach(cleanup);

  it('uses pengunjung.nama as the required visit name', async () => {
    render(<ReservasiPage />);
    await screen.findByText('Rencanakan Kedatangan');

    fireEvent.click(screen.getByText('Bertemu Seseorang'));
    fireEvent.change(screen.getByLabelText('Nama yang Ingin Ditemui'), {
      target: { value: 'Kepala Bidang' },
    });
    fireEvent.change(screen.getByLabelText('Tanggal Kedatangan'), {
      target: { value: '2099-01-02' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buat Reservasi' }));

    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    expect(insert.mock.calls[0][0]).toMatchObject({
      asal: 'reservasi',
      pengunjung_id: 'visitor-1',
      nama: 'Nama Kanonis',
      nama_yang_ditemui: 'Kepala Bidang',
    });
  });
});
