import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [{ id: 'l1', nama: 'Konsultasi OSS' }] }) }) }) }),
  }),
}));

import PengaduanPage from './page';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const uraian = 'Petugas meminta uang di luar tarif resmi saat saya mengurus izin.';

describe('/pengaduan (publik, anonim)', () => {
  it('mencentang anonim menyembunyikan kontak dan MENGOSONGKAN kontak yang sudah terlanjur diketik', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ nomor_tiket: 'PABCDEFGH', lacak_dengan_nomor: true }), { status: 201 }));
    render(<PengaduanPage />);
    fireEvent.change(screen.getByLabelText(/Uraian pengaduan/), { target: { value: uraian } });
    fireEvent.change(screen.getByLabelText(/Kontak/), { target: { value: '081234567890' } });

    fireEvent.click(screen.getByRole('checkbox', { name: /Kirim secara anonim/ }));
    expect(screen.queryByLabelText(/Kontak/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Kirim Pengaduan/ }));
    await screen.findByText('PABCDEFGH');

    const badan = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(badan.anonim).toBe(true);
    expect(badan.kontak).toBeUndefined();
    expect(JSON.stringify(badan)).not.toContain('081234567890');
  });

  it('anonim: layar sukses menjelaskan nomor adalah satu-satunya kunci dan pemantauan cukup dengan nomor', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ nomor_tiket: 'PABCDEFGH', lacak_dengan_nomor: true }), { status: 201 }));
    render(<PengaduanPage />);
    fireEvent.change(screen.getByLabelText(/Uraian pengaduan/), { target: { value: uraian } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Kirim secara anonim/ }));
    fireEvent.click(screen.getByRole('button', { name: /Kirim Pengaduan/ }));

    await screen.findByText('PABCDEFGH');
    expect(screen.getByText(/hanya nomor inilah kuncinya/)).toBeInTheDocument();
    expect(screen.getByText(/dipantau hanya dengan nomor ini/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lacak Pengaduan' })).toHaveAttribute('href', '/pengaduan/lacak');
  });

  it('tidak anonim tanpa kontak ditolak di klien', async () => {
    render(<PengaduanPage />);
    fireEvent.change(screen.getByLabelText(/Uraian pengaduan/), { target: { value: uraian } });
    fireEvent.click(screen.getByRole('button', { name: /Kirim Pengaduan/ }));
    await waitFor(() => expect(screen.getByText(/Isi kontak/)).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
