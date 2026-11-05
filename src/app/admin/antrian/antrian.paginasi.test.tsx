// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
const nav = vi.hoisted(() => ({ query: '', replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace }), usePathname: () => '/admin/antrian',
  useSearchParams: () => new URLSearchParams(nav.query),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/hooks/useRealtimeRefetch', () => ({ useRealtimeRefetch: vi.fn() }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/WalkinWizard', () => ({ default: () => null }));
vi.mock('@/components/admin/PelayananWizardModal', () => ({ default: () => null }));
import AntrianPage from './page';
import { createClient } from '@/lib/supabase/client';
type Baris = ReturnType<typeof tiket>;
function tiket(n: number, status = 'menunggu', milik: string | null = null) {
  return {
    id: `t-${n}`, nomor: n, nomor_display: `A-${String(n).padStart(3, '0')}`, status,
    tanggal: '2026-11-04', layanan_id: 'l-1', dilayani_oleh: milik, kunjungan_id: `k-${n}`, legacy_visit_id: '',
    penanganan_asal_id: null, pelayan: null, waktu_terbit: '2026-11-04T00:00:00Z',
    waktu_mulai_layan: status === 'menunggu' ? null : '2026-11-04T00:10:00Z',
    waktu_selesai: status === 'selesai' ? '2026-11-04T00:20:00Z' : null,
    layanan: { nama: 'Perizinan', form_pendataan: null },
    kunjungan: { nama: `Tamu ${n}`, asal: 'walk_in', waktu_masuk: '2026-11-04T00:00:00Z' }, fo_nama: 'Rina FO',
  };
}
function dataMock(rows: Baris[], role = 'petugas') {
  const rpc = vi.fn((nama: string, args?: Record<string, unknown>) => {
    if (nama === 'fo_antrean_daftar') {
      const awal = Number(args?.p_lewati ?? 0), banyak = Number(args?.p_batas ?? 25);
      return Promise.resolve({ data: { rows: rows.slice(awal, awal + banyak), total: rows.length,
        statistik: { totalSelesai: rows.filter(r => r.status === 'selesai').length, rataWaktuMenit: 10 } }, error: null });
    }
    return Promise.resolve({ data: nama === 'panggil_tiket' ? 'A-001' : { ok: true }, error: null });
  });
  const from = vi.fn((tabel: string) => {
    let hasil = tabel === 'tiket_antrean' ? [...rows] : [] as Baris[];
    let head = false;
    const q = {
      select: (_s?: string, opsi?: { head?: boolean }) => { head = opsi?.head ?? false; return q; },
      eq: (k: string, nilai: unknown) => { hasil = hasil.filter(r => r[k as keyof Baris] === nilai); return q; },
      in: (k: string, nilai: unknown[]) => { hasil = hasil.filter(r => nilai.includes(r[k as keyof Baris])); return q; },
      order: () => { hasil.sort((a, b) => a.nomor - b.nomor); return q; },
      range: (a: number, b: number) => Promise.resolve({ data: hasil.slice(a, b + 1), count: hasil.length, error: null }),
      single: () => Promise.resolve({ data: { id: 'p-saya', role, layanan_id: role === 'petugas' ? 'l-1' : null }, error: null }),
      maybeSingle: () => Promise.resolve({ data: { koordinator: false }, error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: head ? null : hasil, count: hasil.length, error: null }).then(resolve),
    };
    return q;
  });
  vi.mocked(createClient).mockReturnValue({ auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) }, from, rpc } as unknown as ReturnType<typeof createClient>);
  return { rpc, from };
}
const panel = (name: string) => within(screen.getByRole('group', { name }));
const totalHarian = () => screen.getByText('Total Tiket').parentElement!.parentElement!.textContent;
beforeEach(() => { vi.clearAllMocks(); nav.query = ''; vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-04T02:00:00Z')); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it.each(['petugas', 'admin', 'front_office'])('F1: %s pada halaman kedua tetap memanggil nomor pertama', async role => {
  const rows = Array.from({ length: 50 }, (_, i) => tiket(i + 1));
  const mock = dataMock(rows, role);
  render(<AntrianPage />);
  await screen.findByText(/Halaman 1 dari 2/);
  fireEvent.click(screen.getByRole('button', { name: 'Halaman berikutnya' }));
  await screen.findByText(/Halaman 2 dari 2/);
  expect(within(screen.getByRole('region', { name: /Daftar antrean/ })).getByText('A-026')).toBeInTheDocument();
  expect(panel('Berikutnya').getByText('A-001')).toBeInTheDocument();
  fireEvent.click(panel('Berikutnya').getByRole('button', { name: /Panggil berikutnya/ }));
  await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith('panggil_tiket', { p_tiket_id: 't-1' }));
});

it('F1: tiket saya di halaman pertama tetap bisa diselesaikan dari panel halaman kedua', async () => {
  const mock = dataMock([tiket(0, 'dilayani', 'p-saya'), ...Array.from({ length: 50 }, (_, i) => tiket(i + 1))]);
  render(<AntrianPage />);
  await screen.findByText(/Halaman 1 dari 3/);
  fireEvent.click(screen.getByRole('button', { name: 'Halaman berikutnya' }));
  await screen.findByText(/Halaman 2 dari 3/);
  expect(panel('Sedang saya layani').getByText('A-000')).toBeInTheDocument();
  fireEvent.click(panel('Sedang saya layani').getByRole('button', { name: 'Selesai' }));
  await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith('layanan_selesai', { p_tiket_id: 't-0' }));
  await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith('ambil_qr_survei', { p_kunjungan_id: 'k-0' }));
});

it.each(['admin', 'front_office'])('F2: %s menyaring sebelum paginasi, bukan mengosongkan 25 tiket pertama', async role => {
  dataMock([...Array.from({ length: 25 }, (_, i) => tiket(i + 1, 'selesai')), tiket(26)], role);
  render(<AntrianPage />);
  const tabel = within(await screen.findByRole('region', { name: /Daftar antrean/ }));
  expect(await tabel.findByText('Tamu 26')).toBeInTheDocument();
  expect(screen.getByText(/Halaman 1 dari 1.*total 1 data/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Selesai' }));
  expect(await tabel.findByText('Tamu 1')).toBeInTheDocument();
  expect(screen.getByText(/Halaman 1 dari 1.*total 25 data/)).toBeInTheDocument();
});

it('F2: filter Aktif menjangkau halaman RPC berikutnya dan menghitung total paginasi', async () => {
  dataMock([...Array.from({ length: 225 }, (_, i) => tiket(i + 1, 'selesai')),
    ...Array.from({ length: 50 }, (_, i) => tiket(i + 226))], 'front_office');
  render(<AntrianPage />);
  await screen.findByText(/Halaman 1 dari 2.*total 50 data/);
  fireEvent.click(screen.getByRole('button', { name: 'Halaman berikutnya' }));
  await screen.findByText(/Halaman 2 dari 2.*total 50 data/);
  expect(within(screen.getByRole('region', { name: /Daftar antrean/ })).getByText('A-251')).toBeInTheDocument();
  expect(panel('Berikutnya').getByText('A-226')).toBeInTheDocument();
});

it.each(['petugas', 'admin', 'front_office'])('F3: Total Tiket %s tetap total harian ketika tab berubah', async role => {
  dataMock([...Array.from({ length: 25 }, (_, i) => tiket(i + 1, 'selesai')), tiket(26), tiket(27)], role);
  render(<AntrianPage />);
  await screen.findByText(/Halaman 1 dari 1.*total 2 data/);
  expect(totalHarian()).toMatch(/27/);
  fireEvent.click(screen.getByRole('tab', { name: 'Selesai' }));
  await screen.findByText(/Halaman 1 dari 1.*total 25 data/);
  expect(totalHarian()).toMatch(/27/);
  fireEvent.click(screen.getByRole('tab', { name: 'Semua' }));
  await screen.findByText(/Halaman 1 dari 2.*total 27 data/);
  expect(totalHarian()).toMatch(/27/);
});

it('F1: tiket saya setelah 225 tiket aktif tetap ada di panel halaman pertama', async () => {
  dataMock([...Array.from({ length: 225 }, (_, i) => tiket(i + 1)), tiket(226, 'dilayani', 'p-saya')]);
  render(<AntrianPage />);
  expect(await within(await screen.findByRole('group', { name: 'Sedang saya layani' })).findByText('A-226')).toBeInTheDocument();
  expect(panel('Berikutnya').getByText('A-001')).toBeInTheDocument();
});

it('F2: batas biaya RPC gagal jelas sebelum menampilkan panel atau daftar parsial', async () => {
  const mock = dataMock(Array.from({ length: 10_001 }, (_, i) => tiket(i + 1)), 'front_office');
  render(<AntrianPage />);
  expect(await screen.findByText(/melebihi batas pemuatan 10.000 tiket/)).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Berikutnya' })).toBeNull();
  expect(screen.queryByText('Tamu 1')).toBeNull();
  expect(mock.rpc.mock.calls.filter(([n]) => n === 'fo_antrean_daftar')).toHaveLength(1);
});
