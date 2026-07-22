// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('@/components/QRCode', () => ({ default: () => <div>QR</div> }));

import { createClient } from '@/lib/supabase/client';
import ReservasiPage from './page';

describe('reservation payload', () => {
  const insert = vi.fn();
  const consentInsert = vi.fn();
  const rpc = vi.fn();

  // Format tanggal lokal (bukan toISOString yang bergeser karena timezone)
  const toLocalYmd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // Cari hari kerja (Senin–Jumat) dalam 30 hari ke depan agar lolos validasi tanggal
  const nextWeekday = () => {
    const d = new Date();
    for (let i = 0; i < 10; i++) {
      const day = d.getDay();
      if (day !== 0 && day !== 6) return toLocalYmd(d);
      d.setDate(d.getDate() + 1);
    }
    return '';
  };

  beforeEach(() => {
    vi.clearAllMocks();
    insert.mockImplementation((payload: unknown) => ({
      select: () => ({
        single: async () => ({ data: { qr_token: 'qr-token' }, error: null }),
      }),
      payload,
    }));
    consentInsert.mockResolvedValue({ error: null });
    rpc.mockReturnValue({
      maybeSingle: async () => ({ data: null, error: { message: 'not found' } }),
    });

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
    const consentLog = { insert: consentInsert };

    (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'auth-1' } } }) },
      from: vi.fn((table: string) => {
        if (table === 'pengunjung') return pengunjung;
        if (table === 'layanan') return layanan;
        if (table === 'visit') return visit;
        if (table === 'consent_log') return consentLog;
        return {};
      }),
      rpc,
    });
  });

  afterEach(cleanup);

  const fillValidForm = () => {
    fireEvent.click(screen.getByText('Bertemu Seseorang'));
    fireEvent.change(screen.getByLabelText('Nama yang Ingin Ditemui'), {
      target: { value: 'Kepala Bidang' },
    });
    fireEvent.change(screen.getByLabelText('Tanggal Kedatangan'), {
      target: { value: nextWeekday() },
    });
    fireEvent.click(screen.getByLabelText(/saya setuju data saya diproses/i));
  };

  it('uses pengunjung.nama as the required visit name', async () => {
    render(<ReservasiPage />);
    await screen.findByText('Rencanakan Kedatangan');

    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Buat Reservasi' }));

    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    expect(insert.mock.calls[0][0]).toMatchObject({
      asal: 'reservasi',
      pengunjung_id: 'visitor-1',
      nama: 'Nama Kanonis',
      nama_yang_ditemui: 'Kepala Bidang',
    });
  });

  it('records consent_log before inserting the visit', async () => {
    render(<ReservasiPage />);
    await screen.findByText('Rencanakan Kedatangan');

    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Buat Reservasi' }));

    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    expect(consentInsert).toHaveBeenCalledTimes(1);
    expect(consentInsert.mock.calls[0][0]).toMatchObject({
      subjek_ref: 'auth-1',
      tujuan: 'reservasi_data',
      disetujui: true,
      versi_kebijakan: '1.0',
    });
  });

  it('rejects weekend dates with a clear message', async () => {
    render(<ReservasiPage />);
    await screen.findByText('Rencanakan Kedatangan');

    // Cari Sabtu berikutnya dalam 30 hari
    const d = new Date();
    while (d.getDay() !== 6) d.setDate(d.getDate() + 1);
    const saturday = toLocalYmd(d);

    fireEvent.click(screen.getByText('Bertemu Seseorang'));
    fireEvent.change(screen.getByLabelText('Nama yang Ingin Ditemui'), {
      target: { value: 'Kepala Bidang' },
    });
    fireEvent.change(screen.getByLabelText('Tanggal Kedatangan'), {
      target: { value: saturday },
    });
    fireEvent.click(screen.getByLabelText(/saya setuju data saya diproses/i));
    fireEvent.click(screen.getByRole('button', { name: 'Buat Reservasi' }));

    await screen.findByText('Reservasi hanya tersedia pada hari kerja (Senin–Jumat).');
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects dates more than 30 days ahead', async () => {
    render(<ReservasiPage />);
    await screen.findByText('Rencanakan Kedatangan');

    const d = new Date();
    d.setDate(d.getDate() + 60);
    const farDate = toLocalYmd(d);

    fireEvent.click(screen.getByText('Bertemu Seseorang'));
    fireEvent.change(screen.getByLabelText('Nama yang Ingin Ditemui'), {
      target: { value: 'Kepala Bidang' },
    });
    fireEvent.change(screen.getByLabelText('Tanggal Kedatangan'), {
      target: { value: farDate },
    });
    fireEvent.click(screen.getByLabelText(/saya setuju data saya diproses/i));
    fireEvent.click(screen.getByRole('button', { name: 'Buat Reservasi' }));

    await screen.findByText(/maksimal 30 hari ke depan/i);
    expect(insert).not.toHaveBeenCalled();
  });
});
