// @vitest-environment jsdom
// Audit T2d: check-in/tolak lewat scan QR menulis `visit`. Penolakan RLS pada UPDATE = 0 baris tanpa error ->
// jangan menampilkan "Berhasil Diproses" bila perubahan tidak tersimpan.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { todayWIB } from '@/lib/time';

type DbError = { message: string; code?: string };
type UpdateResult = { data: { id: string }[] | null; error: DbError | null };

const h = vi.hoisted(() => ({
  toast: vi.fn(),
  lookups: vi.fn(),
  updates: [] as { payload: Record<string, unknown>; id: string }[],
  state: {
    reservasi: null as Record<string, unknown> | null,
    updateResult: { data: [{ id: 'v1' }], error: null } as UpdateResult,
  },
}));

vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock('@/components/layout/PageHeader', () => ({ default: () => null }));
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element -- test mock for next/image
  default: (props: { alt?: string }) => <img alt={props.alt ?? ''} />,
}));
// Kamera tak tersedia di jsdom: kembalikan pemindai palsu yang "berhasil start" agar input manual tampil.
vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    start = vi.fn().mockResolvedValue(undefined);
    pause = vi.fn();
    resume = vi.fn();
    clear = vi.fn();
  },
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => {
        const b: Record<string, unknown> = {};
        b.eq = () => b;
        b.single = () => {
          h.lookups();
          return Promise.resolve(
            h.state.reservasi
              ? { data: h.state.reservasi, error: null }
              : { data: null, error: { message: 'no rows' } },
          );
        };
        return b;
      },
      update: (payload: Record<string, unknown>) => ({
        eq: (_kolom: string, id: string) => ({
          select: () => {
            h.updates.push({ payload, id });
            return Promise.resolve(h.state.updateResult);
          },
        }),
      }),
    }),
  }),
}));

import AdminScanPage from './page';

const reservasi = (over: Record<string, unknown> = {}) => ({
  id: 'v1',
  tujuan: 'loket',
  nama_yang_ditemui: null,
  tanggal_rencana: todayWIB(),
  jam_rencana: null,
  keperluan: 'Urus NIB',
  status: 'terjadwal',
  qr_token: 'tok-1',
  pengunjung: { nama: 'Budi', email: 'budi@example.com', foto_url: null },
  layanan: { nama: 'Helpdesk OSS' },
  ...over,
});

async function pindaiManual() {
  render(<AdminScanPage />);
  const input = await screen.findByPlaceholderText(/Tempel token QR/i);
  fireEvent.change(input, { target: { value: 'tok-1' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  return screen.findByRole('button', { name: /Arahkan ke Loket Helpdesk OSS/i });
}

describe('Admin scan QR: mutasi visit dicek (tidak ada sukses palsu)', () => {
  beforeEach(() => {
    h.toast.mockClear();
    h.lookups.mockClear();
    h.updates.length = 0;
    h.state.reservasi = reservasi();
    h.state.updateResult = { data: [{ id: 'v1' }], error: null };
  });
  afterEach(cleanup);

  it('check-in berhasil (baris terbukti) -> "Berhasil Diproses" + payload status menunggu', async () => {
    fireEvent.click(await pindaiManual());

    expect(await screen.findByText(/Berhasil Diproses/)).toBeInTheDocument();
    expect(h.updates[0]).toMatchObject({ id: 'v1', payload: { status: 'menunggu' } });
    expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'error');
  });

  it('check-in: 0 baris terdampak (RLS menolak diam-diam) -> BUKAN "Berhasil Diproses", toast gagal, pindai dimuat ulang', async () => {
    h.state.updateResult = { data: [], error: null };
    fireEvent.click(await pindaiManual());

    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('Gagal memproses'), 'error'),
    );
    expect(screen.queryByText(/Berhasil Diproses/)).toBeNull();
    // status reservasi dibaca ulang dari server (tampilan kemungkinan basi): lookup awal + ulang
    await waitFor(() => expect(h.lookups).toHaveBeenCalledTimes(2));
  });

  it('check-in: error jaringan -> toast gagal tanpa pesan teknis, BUKAN "Berhasil Diproses", tanpa lookup ulang', async () => {
    h.state.updateResult = { data: null, error: { message: 'TypeError: Failed to fetch', code: '' } };
    fireEvent.click(await pindaiManual());

    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('Koneksi bermasalah'), 'error'),
    );
    expect(h.toast).not.toHaveBeenCalledWith(expect.stringContaining('Failed to fetch'), 'error');
    expect(screen.queryByText(/Berhasil Diproses/)).toBeNull();
    expect(h.lookups).toHaveBeenCalledTimes(1);
  });

  it('check-in: tombol kembali aktif setelah gagal agar petugas bisa mencoba lagi', async () => {
    h.state.updateResult = { data: [], error: null };
    const tombol = await pindaiManual();
    fireEvent.click(tombol);
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.anything(), 'error'));
    await waitFor(() => expect(screen.queryByText(/Memproses/)).toBeNull());
  });

  it('Tolak Pengunjung: berhasil -> payload status batal + "Berhasil Diproses"', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await pindaiManual();
    fireEvent.click(screen.getByRole('button', { name: /Tolak Pengunjung/i }));

    expect(await screen.findByText(/Berhasil Diproses/)).toBeInTheDocument();
    expect(h.updates[0]).toMatchObject({ id: 'v1', payload: { status: 'batal' } });
  });

  it('Tolak Pengunjung: 0 baris -> BUKAN "Berhasil Diproses", toast gagal', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    h.state.updateResult = { data: [], error: null };
    await pindaiManual();
    fireEvent.click(screen.getByRole('button', { name: /Tolak Pengunjung/i }));

    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('Gagal memproses'), 'error'),
    );
    expect(screen.queryByText(/Berhasil Diproses/)).toBeNull();
  });
});
