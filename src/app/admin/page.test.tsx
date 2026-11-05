// @vitest-environment jsdom
// Dashboard admin: B-01 (muat ulang realtime/polling tidak membongkar angka & grafik jadi spinner) dan
// galat kueri tidak boleh tampil sebagai angka 0.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';

type Hasil = { data?: unknown; count?: number | null; error: { message: string } | null };

const m = vi.hoisted(() => ({
  hasil: {} as Record<string, () => Hasil | Promise<Hasil>>,
  refetch: null as null | (() => Promise<void>),
}));

vi.mock('@/components/admin/CalendarBanner', () => ({ default: () => null }));
vi.mock('@/lib/hooks/useRealtimeRefetch', () => ({
  useRealtimeRefetch: (fn: () => Promise<void>) => { m.refetch = fn; },
}));
// Recharts memerlukan ukuran layout nyata; tiruan cukup karena yang diuji adalah state halaman.
vi.mock('recharts', () => {
  const Kosong = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    BarChart: Kosong, Bar: Kosong, XAxis: Kosong, YAxis: Kosong, CartesianGrid: Kosong, Tooltip: Kosong,
    ResponsiveContainer: Kosong, PieChart: Kosong, Pie: Kosong, Cell: Kosong, Legend: Kosong,
  };
});
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    from: (tabel: string) => {
      // kunci kueri: tabel + penanda status/peran agar tiap kueri dashboard bisa dijawab terpisah
      let kunci = tabel;
      const b: Record<string, unknown> = {};
      const rantai = () => b;
      b.select = (_k: string, o?: { head?: boolean }) => { if (o?.head) kunci += ':count'; return b; };
      b.eq = (k: string, v: string) => { if (k === 'status') kunci += `:${v}`; return b; };
      b.neq = rantai; b.gte = rantai; b.lte = rantai; b.in = () => { kunci += ':breakdown'; return b; };
      b.not = rantai; b.order = rantai;
      b.limit = () => { kunci += ':recent'; return b; };
      b.maybeSingle = () => Promise.resolve({ data: { role: 'admin' }, error: null });
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve((m.hasil[kunci] ?? (() => ({ data: [], count: 0, error: null })))()).then(res, rej);
      return b;
    },
  }),
}));

import AdminDashboard from './page';

const BAIK: Record<string, () => Hasil> = {
  'kunjungan:count': () => ({ count: 7, error: null }),
  'tiket_antrean:count:menunggu': () => ({ count: 3, error: null }),
  'tiket_antrean:count:selesai': () => ({ count: 4, error: null }),
};

beforeEach(() => {
  m.hasil = { ...BAIK };
  m.refetch = null;
});
afterEach(cleanup);

describe('Dashboard admin: B-01 muat ulang senyap', () => {
  it('angka hari ini tampil setelah muat awal', async () => {
    render(<AdminDashboard />);
    expect(await screen.findByText('Hadir hari ini')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('muat ulang realtime/polling tidak menampilkan spinner: kartu statistik tetap ada selama menunggu', async () => {
    const { container } = render(<AdminDashboard />);
    await screen.findByText('7');
    let buka!: () => void;
    const gerbang = new Promise<void>((r) => { buka = r; });
    m.hasil['kunjungan:count'] = () => gerbang.then(() => ({ count: 9, error: null })) as unknown as Hasil;

    let selesai!: Promise<void>;
    act(() => { selesai = m.refetch!(); });
    expect(container.querySelector('.spinner')).toBeNull();
    expect(screen.getByText('7')).toBeInTheDocument();

    buka();
    await act(async () => { await selesai; });
    expect(screen.getByText('9')).toBeInTheDocument();
  });

  it('muat ulang senyap gagal: angka lama tetap + catatan, bukan 0', async () => {
    render(<AdminDashboard />);
    await screen.findByText('7');
    m.hasil['kunjungan:count'] = () => ({ count: null, error: { message: 'Failed to fetch' } });
    await act(async () => { await m.refetch!(); });
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText(/Data terakhir .* WIB, mencoba lagi/)).toBeInTheDocument();
  });

  it('muat awal gagal: pesan galat + Coba lagi, bukan kartu berangka 0; Coba lagi memulihkan', async () => {
    m.hasil['tiket_antrean:count:menunggu'] = () => ({ count: null, error: { message: 'Failed to fetch' } });
    render(<AdminDashboard />);
    expect(await screen.findByText(/Data dashboard tidak dapat dimuat/)).toBeInTheDocument();
    expect(screen.queryByText('Sedang menunggu')).toBeNull();
    m.hasil = { ...BAIK };
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(await screen.findByText('Sedang menunggu')).toBeInTheDocument();
    expect(screen.queryByText(/Data dashboard tidak dapat dimuat/)).toBeNull();
  });

  it('tombol esensial Admin tetap ada dengan tujuan yang sama', async () => {
    render(<AdminDashboard />);
    await screen.findByText('Hadir hari ini');
    const tujuan = (nama: RegExp | string) => (screen.getByRole('link', { name: nama }) as HTMLAnchorElement).getAttribute('href');
    expect(tujuan('Daftarkan Pengunjung Walk-in')).toBe('/admin/fo/registrasi?tab=walkin');
    expect(await screen.findByRole('link', { name: 'Tambah Petugas' })).toHaveAttribute('href', '/admin/petugas/invite');
    expect(tujuan('Tata Kelola Data (DPO)')).toBe('/admin/data-governance');
    expect(tujuan('Pesan Perilaku')).toBe('/admin/pesan-perilaku');
    expect(tujuan('Log Asisten AI')).toBe('/admin/chat/ai-log');
    expect(tujuan('Lihat antrean')).toBe('/admin/antrian');
    expect(tujuan('Kelola layar TV')).toBe('/admin/layar');
  });
});
