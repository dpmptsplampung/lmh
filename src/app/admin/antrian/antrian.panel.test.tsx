// @vitest-environment jsdom
// A1 + A3 pada halaman: panel "Sekarang" memakai penangan yang sama dengan tabel (panggil_tiket, layanan_mulai,
// layanan_selesai) dan hanya tampil untuk hari ini pada tab Aktif/Semua. Perilaku tombol panel dirinci di PanelSekarang.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';

const nav = vi.hoisted(() => ({ query: '', replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => '/admin/antrian',
  useSearchParams: () => new URLSearchParams(nav.query),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/hooks/useRealtimeRefetch', () => ({ useRealtimeRefetch: vi.fn() }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/layout/PageHeader', () => ({
  default: ({ title, children }: { title: string; children?: React.ReactNode }) => (
    <div><h1>{title}</h1>{children}</div>
  ),
}));
vi.mock('@/components/Pagination', () => ({ default: () => null }));
vi.mock('@/components/WalkinWizard', () => ({ default: () => null }));
vi.mock('@/components/admin/PelayananWizardModal', () => ({ default: () => null }));

import AntrianPage from './page';
import { createClient } from '@/lib/supabase/client';

const SAYA = 'p-saya';

type Baris = Record<string, unknown>;

const baris = (over: Baris = {}): Baris => ({
  id: 't-1',
  kunjungan_id: 'k-1',
  legacy_visit_id: 'v-1',
  layanan_id: 'l-1',
  dilayani_oleh: null,
  penanganan_asal_id: null,
  pelayan: null,
  nomor: 1,
  nomor_display: 'A-001',
  status: 'menunggu',
  waktu_terbit: new Date().toISOString(),
  waktu_mulai_layan: null,
  waktu_selesai: null,
  layanan: { nama: 'Helpdesk OSS', form_pendataan: null },
  kunjungan: { nama: 'Budi', asal: 'walk_in', waktu_masuk: new Date().toISOString() },
  ...over,
});

function buatMock(rows: Baris[], role: 'petugas' | 'admin' | 'front_office') {
  const range = vi.fn().mockResolvedValue({ data: rows, count: rows.length });
  const inStatus = vi.fn().mockReturnValue({ range, eq: vi.fn().mockReturnValue({ range }) });
  const order = vi.fn().mockReturnValue({ range, in: inStatus, eq: vi.fn().mockReturnValue({ range }) });
  const hasilStats = (): Promise<{ data: Baris[]; count: number }> & { eq: () => unknown } =>
    Object.assign(Promise.resolve({ data: [], count: 0 }), { eq: () => hasilStats() });
  const eqTanggal = vi.fn().mockReturnValue({ order, eq: vi.fn(() => hasilStats()) });
  const tiketSelect = vi.fn().mockReturnValue({ eq: eqTanggal });
  const petugasEq = vi.fn().mockReturnValue({
    single: vi.fn().mockResolvedValue({
      data: { id: SAYA, role, layanan_id: role === 'petugas' ? 'l-1' : null, layanan: { nama: 'Helpdesk OSS' } },
      error: null,
    }),
    maybeSingle: vi.fn().mockResolvedValue({ data: { koordinator: false }, error: null }),
  });
  const rpc = vi.fn((nama: string) => {
    if (nama === 'fo_antrean_daftar') return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'fungsi tidak ada' } });
    if (nama === 'panggil_tiket') return Promise.resolve({ data: 'A-001', error: null });
    if (nama === 'layanan_mulai') return Promise.resolve({ data: { ok: true, sudah_milik_anda: false }, error: null });
    if (nama === 'layanan_selesai') return Promise.resolve({ data: { ok: true }, error: null });
    return Promise.resolve({ data: null, error: { message: 'tak dikenal' } });
  });
  const rantaiKosong = () => {
    const p: Record<string, unknown> = {
      select: () => p, order: () => p, eq: () => p, in: () => p,
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res),
    };
    return p;
  };
  const mock = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    from: vi.fn((tabel: string) => {
      if (tabel === 'petugas') return { select: vi.fn().mockReturnValue({ eq: petugasEq }) };
      if (tabel === 'tiket_antrean') return { select: tiketSelect };
      return rantaiKosong();
    }),
    rpc,
    _inStatus: inStatus,
  };
  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mock);
  return mock;
}

const blokBerikutnya = () => screen.getByRole('group', { name: 'Berikutnya' });
const blokSaya = () => screen.getByRole('group', { name: 'Sedang saya layani' });
const panggilan = (mock: ReturnType<typeof buatMock>, nama: string) =>
  (mock.rpc.mock.calls as unknown as Array<[string, Record<string, unknown>]>).filter(([n]) => n === nama);

beforeEach(() => {
  vi.clearAllMocks();
  nav.query = '';
});
afterEach(cleanup);

describe('Antrean: panel Sekarang pada halaman', () => {
  it('Petugas: tiket menunggu bernomor terkecil di Layanannya menjadi "Berikutnya"; tiket yang ia layani tampil di "Sedang saya layani"', async () => {
    buatMock([
      baris({ id: 't-3', nomor: 3, nomor_display: 'A-003', kunjungan: { nama: 'Cici', asal: 'walk_in', waktu_masuk: null } }),
      baris({ id: 't-2', nomor: 2, nomor_display: 'A-002', kunjungan: { nama: 'Dewi', asal: 'walk_in', waktu_masuk: null } }),
      baris({
        id: 't-0', nomor: 0, nomor_display: 'A-000', status: 'dilayani', dilayani_oleh: SAYA,
        waktu_mulai_layan: new Date().toISOString(), kunjungan: { nama: 'Sari', asal: 'walk_in', waktu_masuk: null },
      }),
    ], 'petugas');
    render(<AntrianPage />);
    expect(await within(await screen.findByRole('group', { name: 'Berikutnya' })).findByText('A-002')).toBeInTheDocument();
    expect(within(blokBerikutnya()).getByText('Dewi')).toBeInTheDocument();
    expect(within(blokSaya()).getByText('A-000')).toBeInTheDocument();
    expect(within(blokSaya()).getByRole('button', { name: 'Selesai' })).toBeInTheDocument();
  });

  it('Panggil berikutnya memanggil panggil_tiket untuk tiket itu; Mulai layanan memanggil layanan_mulai', async () => {
    const mock = buatMock([baris({ id: 't-9', nomor_display: 'A-009' })], 'petugas');
    render(<AntrianPage />);
    await screen.findByRole('group', { name: 'Berikutnya' });
    fireEvent.click(within(blokBerikutnya()).getByRole('button', { name: /Panggil berikutnya/ }));
    await waitFor(() => expect(panggilan(mock, 'panggil_tiket')).toHaveLength(1));
    expect(panggilan(mock, 'panggil_tiket')[0][1]).toEqual({ p_tiket_id: 't-9' });
    expect(await within(blokBerikutnya()).findByText('Sudah dipanggil')).toBeInTheDocument();
    fireEvent.click(within(blokBerikutnya()).getByRole('button', { name: /Mulai layanan/ }));
    await waitFor(() => expect(panggilan(mock, 'layanan_mulai')).toHaveLength(1));
    expect(panggilan(mock, 'layanan_mulai')[0][1]).toEqual({ p_tiket_id: 't-9' });
  });

  it('pintasan N di panel memanggil tiket berikutnya; Selesai di panel menyelesaikan tiket saya (tanpa pendataan)', async () => {
    const mock = buatMock([
      baris({ id: 't-1' }),
      baris({
        id: 't-0', nomor: 0, nomor_display: 'A-000', status: 'dilayani', dilayani_oleh: SAYA,
        waktu_mulai_layan: new Date().toISOString(),
      }),
    ], 'petugas');
    render(<AntrianPage />);
    await screen.findByRole('group', { name: 'Berikutnya' });
    fireEvent.keyDown(within(blokBerikutnya()).getByRole('button', { name: /Panggil berikutnya/ }), { key: 'n' });
    await waitFor(() => expect(panggilan(mock, 'panggil_tiket')).toHaveLength(1));
    fireEvent.click(within(blokSaya()).getByRole('button', { name: 'Selesai' }));
    await waitFor(() => expect(panggilan(mock, 'layanan_selesai')).toHaveLength(1));
    expect(panggilan(mock, 'layanan_selesai')[0][1]).toEqual({ p_tiket_id: 't-0' });
  });

  it('Admin dengan banyak Layanan memilih Layanan dulu; "Berikutnya" mengikuti pilihan', async () => {
    buatMock([
      baris({ id: 't-1', nomor_display: 'A-001', layanan_id: 'l-1', layanan: { nama: 'Helpdesk OSS' } }),
      baris({
        id: 't-5', nomor: 5, nomor_display: 'B-005', layanan_id: 'l-2', layanan: { nama: 'BPJS Kesehatan' },
        kunjungan: { nama: 'Eko', asal: 'walk_in', waktu_masuk: null },
      }),
    ], 'admin');
    render(<AntrianPage />);
    const pilih = await screen.findByLabelText('Layanan');
    expect(within(pilih).getAllByRole('option').map((o) => o.textContent)).toEqual(['BPJS Kesehatan', 'Helpdesk OSS']);
    expect(within(blokBerikutnya()).getByText('B-005')).toBeInTheDocument();
    fireEvent.change(pilih, { target: { value: 'l-1' } });
    expect(within(blokBerikutnya()).getByText('A-001')).toBeInTheDocument();
  });

  it('Front Office: tanpa blok "Sedang saya layani" dan tanpa tombol Mulai layanan', async () => {
    buatMock([baris()], 'front_office');
    render(<AntrianPage />);
    await screen.findByRole('group', { name: 'Berikutnya' });
    expect(screen.queryByRole('group', { name: 'Sedang saya layani' })).toBeNull();
    expect(within(blokBerikutnya()).queryByRole('button', { name: /Mulai layanan/ })).toBeNull();
    expect(within(blokBerikutnya()).getByRole('button', { name: /Panggil berikutnya/ })).toBeInTheDocument();
  });

  it('tab Selesai dan tanggal selain hari ini: panel tidak tampil (datanya bukan antrean berjalan)', async () => {
    nav.query = 'status=selesai';
    buatMock([baris({ status: 'selesai' })], 'petugas');
    render(<AntrianPage />);
    await screen.findByText('Budi');
    expect(screen.queryByRole('group', { name: 'Berikutnya' })).toBeNull();
    cleanup();
    nav.query = 'tanggal=2026-01-02';
    buatMock([baris()], 'petugas');
    render(<AntrianPage />);
    await screen.findByText('Budi');
    expect(screen.queryByRole('group', { name: 'Berikutnya' })).toBeNull();
  });

  it('tabel tetap memuat semua aksi barisnya di bawah panel', async () => {
    buatMock([baris()], 'petugas');
    render(<AntrianPage />);
    await screen.findByRole('group', { name: 'Berikutnya' });
    const tabel = screen.getByRole('region', { name: /Daftar antrean/ });
    expect(within(tabel).getByRole('button', { name: 'Panggil' })).toBeInTheDocument();
    expect(within(tabel).getByRole('button', { name: 'Mulai Layanan' })).toBeInTheDocument();
  });
});
