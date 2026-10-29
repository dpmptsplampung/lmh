import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const TOKEN = 'c'.repeat(64);
const rpc = vi.fn();
const ganti = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: TOKEN }),
  useRouter: () => ({ replace: ganti, push: vi.fn() }),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc }) }));

import SurveiPage from './page';

const konteks = (status: string) => ({
  data: { status, unit: 'layanan', layanan_nama: 'Konsultasi OSS', kedaluwarsa_pada: '2026-10-28T10:00:00+00:00' },
  error: null,
});

beforeEach(() => {
  sessionStorage.clear();
  rpc.mockReset();
  ganti.mockReset();
});
afterEach(() => cleanup());

describe('halaman /survei/[token]', () => {
  it('memuat konteks dengan token dari URL lalu menampilkan wizard di bawah judul "Pesan Perilaku"', async () => {
    rpc.mockResolvedValue(konteks('ok'));
    render(<SurveiPage />);

    expect(screen.getByRole('status')).toHaveTextContent('Memuat');
    expect(await screen.findByRole('heading', { level: 2, name: /Survey Persepsi Anti Korupsi/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Pesan Perilaku' })).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith('get_survei_context', { p_token: TOKEN });
  });

  it.each([
    ['kedaluwarsa', 'Waktu pengisian sudah berakhir'],
    ['sudah_diisi', 'Terima kasih, survei ini sudah Anda isi'],
    ['tidak_valid', 'Tautan survei tidak dikenali'],
  ])('status %s menampilkan pesan ramah, bukan wizard', async (status, judul) => {
    rpc.mockResolvedValue(konteks(status));
    render(<SurveiPage />);

    expect(await screen.findByRole('heading', { level: 2, name: judul })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('gagal memuat menampilkan ErrorRetry (bukan "tautan tidak dikenali"); Coba lagi memuat ulang', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } });
    rpc.mockResolvedValueOnce(konteks('ok'));
    render(<SurveiPage />);

    const galat = await screen.findByRole('alert');
    expect(galat).toHaveTextContent('Gagal memuat');
    expect(screen.queryByText('Tautan survei tidak dikenali')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }), { detail: 1 });
    expect(await screen.findByRole('heading', { level: 2, name: /Survey Persepsi Anti Korupsi/ })).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
