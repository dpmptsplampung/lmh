// @vitest-environment jsdom
// Halaman antrean admin (A3, migrasi 202610140002_tiket_kepemilikan): transisi status lewat RPC atomik
// (layanan_mulai / layanan_selesai / admin_ambil_alih), BUKAN UPDATE langsung visit. Hanya pemilik tiket
// (dilayani_oleh) yang melihat tombol Selesai / Form Pendataan.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';

const toastMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('@/components/layout/PageHeader', () => ({
  default: ({ title, children }: { title: string; children?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

vi.mock('@/components/Pagination', () => ({
  default: () => null,
}));

vi.mock('@/components/WalkinWizard', () => ({
  default: ({ triggerLabel, triggerClassName }: { triggerLabel: string; triggerClassName: string }) => (
    <button type="button" className={triggerClassName}>{triggerLabel}</button>
  ),
}));

// Mock PelayananWizardModal: teks "Pendataan Pelayanan" saat isOpen=true, "PendataanClosed" saat false.
vi.mock('@/components/admin/PelayananWizardModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => (
    <div data-testid="pelayanan-wizard">{isOpen ? 'Pendataan Pelayanan' : 'PendataanClosed'}</div>
  ),
}));

import AntrianPage from './page';
import { createClient } from '@/lib/supabase/client';

type AntrianRow = {
  id: string;
  legacy_visit_id: string;
  layanan_id: string;
  dilayani_oleh: string | null;
  pelayan: { nama: string } | null;
  nomor: number;
  nomor_display: string;
  status: string;
  waktu_terbit: string | null;
  waktu_mulai_layan: string | null;
  waktu_selesai: string | null;
  layanan: { nama: string } | { nama: string }[];
  kunjungan: { nama: string; asal: string; waktu_masuk: string | null } |
    { nama: string; asal: string; waktu_masuk: string | null }[];
};

type DbError = { message: string; code?: string };
type HasilRpc = { data: unknown; error: DbError | null };

const SAYA = 'p-saya';

function buildMock(opts: {
  rows?: AntrianRow[];
  role?: string;
  layananId?: string | null;
  // Hasil RPC per nama; nilai bisa Promise (untuk menguji tombol terkunci selama request).
  rpc?: Partial<Record<'panggil_tiket' | 'layanan_mulai' | 'layanan_selesai' | 'admin_ambil_alih', HasilRpc | Promise<HasilRpc>>>;
} = {}) {
  const rows = opts.rows ?? [];
  const role = opts.role ?? 'admin';
  const layananId = opts.layananId === undefined ? (role === 'petugas' ? 'l-1' : null) : opts.layananId;

  const range = vi.fn().mockResolvedValue({ data: rows, count: rows.length });
  const order = vi.fn().mockReturnValue({ range, eq: vi.fn().mockReturnValue({ range }) });
  const statsEq = vi.fn().mockResolvedValue({ data: rows, count: rows.length });
  const eqTanggal = vi.fn().mockReturnValue({ order, eq: statsEq });
  const tiketSelect = vi.fn().mockReturnValue({ eq: eqTanggal });

  const petugasSingle = vi.fn().mockResolvedValue({
    data: { id: SAYA, role, layanan_id: layananId, layanan: { nama: 'Helpdesk OSS' } },
    error: null,
  });
  const petugasEq = vi.fn().mockReturnValue({ single: petugasSingle });
  const petugasSelect = vi.fn().mockReturnValue({ eq: petugasEq });

  // visit TIDAK boleh lagi di-UPDATE oleh halaman ini (A3): spy untuk membuktikannya.
  const visitUpdate = vi.fn();

  const hasilDefault: Record<string, HasilRpc> = {
    panggil_tiket: { data: 'A-001', error: null },
    layanan_mulai: { data: { ok: true, sudah_milik_anda: false }, error: null },
    layanan_selesai: { data: { ok: true, is_locked: false }, error: null },
    admin_ambil_alih: { data: { ok: true, sudah_milik_anda: false }, error: null },
  };
  const rpc = vi.fn((nama: string) => {
    const atur = opts.rpc?.[nama as keyof NonNullable<typeof opts.rpc>];
    return Promise.resolve(atur ?? hasilDefault[nama] ?? { data: null, error: { message: 'tak dikenal' } });
  });

  const mock = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },
    from: vi.fn((table: string) => {
      if (table === 'petugas') return { select: petugasSelect };
      if (table === 'tiket_antrean') return { select: tiketSelect };
      if (table === 'visit') return { update: visitUpdate };
      return {};
    }),
    rpc,
    _visitUpdate: visitUpdate,
    _tiketSelect: tiketSelect,
  };

  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mock);
  return mock;
}

const baseRow = (over: Partial<AntrianRow> = {}): AntrianRow => ({
  id: 't-1',
  legacy_visit_id: 'v-1',
  layanan_id: 'l-1',
  dilayani_oleh: null,
  pelayan: null,
  nomor: 1,
  nomor_display: 'A-001',
  status: 'menunggu',
  waktu_terbit: new Date().toISOString(),
  waktu_mulai_layan: null,
  waktu_selesai: null,
  layanan: { nama: 'Helpdesk OSS' },
  kunjungan: { nama: 'Budi', asal: 'walk_in', waktu_masuk: new Date().toISOString() },
  ...over,
});

const dilayaniSaya = (over: Partial<AntrianRow> = {}) =>
  baseRow({ status: 'dilayani', dilayani_oleh: SAYA, waktu_mulai_layan: new Date().toISOString(), ...over });
const dilayaniLain = (over: Partial<AntrianRow> = {}) =>
  baseRow({
    status: 'dilayani', dilayani_oleh: 'p-lain', pelayan: { nama: 'Petugas Dua' },
    waktu_mulai_layan: new Date().toISOString(), ...over,
  });

const jumlahMuat = (mock: ReturnType<typeof buildMock>) =>
  mock.from.mock.calls.filter(([t]) => t === 'tiket_antrean').length;

beforeEach(() => {
  vi.clearAllMocks();
  toastMock.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('Admin antrian: daftar', () => {
  it('memuat walk_in dan reservasi (tidak memfilter asal)', async () => {
    buildMock({
      rows: [
        baseRow({ id: 't-walk', kunjungan: { nama: 'Walk In', asal: 'walk_in', waktu_masuk: new Date().toISOString() } }),
        baseRow({ id: 't-res', nomor: 2, nomor_display: 'A-002', kunjungan: { nama: 'Reservasi User', asal: 'reservasi', waktu_masuk: new Date().toISOString() } }),
      ],
    });
    render(<AntrianPage />);
    expect(await screen.findByText('Walk In')).toBeInTheDocument();
    expect(screen.getByText('Reservasi User')).toBeInTheDocument();
    expect(screen.getAllByText(/walk-in/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Reservasi$/i).length).toBeGreaterThan(0);
  });

  it('kueri tiket memuat dilayani_oleh dan nama pemilik', async () => {
    const mock = buildMock({ rows: [baseRow()] });
    render(<AntrianPage />);
    await screen.findByText('Budi');
    const kolom = String(mock._tiketSelect.mock.calls[0][0]);
    expect(kolom).toMatch(/dilayani_oleh/);
    expect(kolom).toMatch(/pelayan:dilayani_oleh\(nama\)/);
    expect(kolom).toMatch(/layanan_id/);
  });
});

describe('Admin antrian: Mulai Layanan lewat RPC layanan_mulai', () => {
  it('memanggil rpc layanan_mulai (bukan UPDATE visit)', async () => {
    const mock = buildMock({ rows: [baseRow()] });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /mulai layanan/i }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith('layanan_mulai', { p_tiket_id: 't-1' }));
    expect(mock._visitUpdate).not.toHaveBeenCalled();
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('Layanan dimulai', 'success'));
  });

  it('membuka wizard pendataan otomatis untuk Helpdesk OSS', async () => {
    buildMock({ rows: [baseRow()] });
    render(<AntrianPage />);
    expect(screen.getByTestId('pelayanan-wizard')).toHaveTextContent('PendataanClosed');
    fireEvent.click(await screen.findByRole('button', { name: /mulai layanan/i }));
    await waitFor(() => expect(screen.getByTestId('pelayanan-wizard')).toHaveTextContent('Pendataan Pelayanan'));
  });

  it('tidak membuka wizard untuk layanan tanpa pendataan', async () => {
    buildMock({ rows: [baseRow({ layanan: { nama: 'BPJS Kesehatan' } })] });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /mulai layanan/i }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('Layanan ini tidak memiliki form pendataan', 'info'));
    expect(screen.getByTestId('pelayanan-wizard')).toHaveTextContent('PendataanClosed');
  });

  it('tombol terkunci selama request (klik ganda tidak memanggil RPC dua kali) dan status diumumkan aria-live', async () => {
    let selesaikan: (v: HasilRpc) => void = () => {};
    const tertunda = new Promise<HasilRpc>((r) => { selesaikan = r; });
    const mock = buildMock({ rows: [baseRow()], rpc: { layanan_mulai: tertunda } });
    render(<AntrianPage />);
    const tombol = await screen.findByRole('button', { name: /mulai layanan/i });
    fireEvent.click(tombol);
    fireEvent.click(tombol);

    const sibuk = await screen.findByRole('button', { name: /memproses/i });
    expect(sibuk).toBeDisabled();
    expect(sibuk).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(sibuk);
    expect(mock.rpc.mock.calls.filter(([n]) => n === 'layanan_mulai')).toHaveLength(1);
    expect(screen.getByText('Memulai layanan A-001…')).toBeInTheDocument();
    expect(screen.getByText('Memulai layanan A-001…')).toHaveAttribute('aria-live', 'polite');

    selesaikan({ data: { ok: true, sudah_milik_anda: false }, error: null });
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('Layanan dimulai', 'success'));
    expect(screen.queryByText('Memulai layanan A-001…')).not.toBeInTheDocument();
  });

  it('SUDAH_DIAMBIL -> "Tiket ini sudah ditangani petugas lain", daftar dimuat ulang, wizard tidak terbuka', async () => {
    const mock = buildMock({
      rows: [baseRow()],
      rpc: { layanan_mulai: { data: null, error: { message: 'SUDAH_DIAMBIL: tiket sudah ditangani petugas lain', code: 'P0001' } } },
    });
    render(<AntrianPage />);
    await screen.findByRole('button', { name: /mulai layanan/i });
    const sebelum = jumlahMuat(mock);
    fireEvent.click(screen.getByRole('button', { name: /mulai layanan/i }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('Tiket ini sudah ditangani petugas lain'), 'error'),
    );
    await waitFor(() => expect(jumlahMuat(mock)).toBeGreaterThan(sebelum));
    expect(toastMock).not.toHaveBeenCalledWith('Layanan dimulai', 'success');
    expect(screen.getByTestId('pelayanan-wizard')).toHaveTextContent('PendataanClosed');
  });

  it('klik ganda oleh pemilik yang sama (sudah_milik_anda) tetap sukses, bukan galat', async () => {
    buildMock({ rows: [baseRow()], rpc: { layanan_mulai: { data: { ok: true, sudah_milik_anda: true }, error: null } } });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /mulai layanan/i }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('Layanan tiket ini sudah Anda mulai sebelumnya', 'success'));
  });

  it('balasan kosong tanpa error -> gagal (bukan sukses palsu)', async () => {
    buildMock({ rows: [baseRow()], rpc: { layanan_mulai: { data: null, error: null } } });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /mulai layanan/i }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('Gagal memulai layanan'), 'error'));
    expect(toastMock).not.toHaveBeenCalledWith('Layanan dimulai', 'success');
    expect(screen.getByTestId('pelayanan-wizard')).toHaveTextContent('PendataanClosed');
  });

  it('error DB lain -> toast gagal, bukan sukses', async () => {
    buildMock({ rows: [baseRow()], rpc: { layanan_mulai: { data: null, error: { message: 'boom', code: 'XX000' } } } });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /mulai layanan/i }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('Gagal memulai layanan'), 'error'));
    expect(toastMock).not.toHaveBeenCalledWith('Layanan dimulai', 'success');
  });

  it('SESI_TIDAK_SAH -> pesan masuk kembali', async () => {
    buildMock({
      rows: [baseRow()],
      rpc: { layanan_mulai: { data: null, error: { message: 'SESI_TIDAK_SAH: sesi Anda tidak berlaku lagi', code: '42501' } } },
    });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /mulai layanan/i }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringMatching(/Gagal memulai layanan\. Sesi Anda sudah tidak berlaku/), 'error'));
  });

  it('peran: Front Office dan petugas layanan lain tidak melihat Mulai Layanan; petugas layanannya melihat', async () => {
    buildMock({ rows: [baseRow()], role: 'front_office' });
    render(<AntrianPage />);
    await screen.findByText('Budi');
    expect(screen.queryByRole('button', { name: /mulai layanan/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^panggil$/i })).toBeInTheDocument();
    cleanup();

    buildMock({ rows: [baseRow({ layanan_id: 'l-lain' })], role: 'petugas', layananId: 'l-1' });
    render(<AntrianPage />);
    await screen.findByText('Budi');
    expect(screen.queryByRole('button', { name: /mulai layanan/i })).not.toBeInTheDocument();
    cleanup();

    buildMock({ rows: [baseRow()], role: 'petugas', layananId: 'l-1' });
    render(<AntrianPage />);
    expect(await screen.findByRole('button', { name: /mulai layanan/i })).toBeInTheDocument();
  });

  it('tidak ada tombol "Lengkapi Data" saat menunggu (draf hanya setelah Mulai, keputusan 7.5) dan tidak ada Selesai', async () => {
    buildMock({ rows: [baseRow()] });
    render(<AntrianPage />);
    await screen.findByRole('button', { name: /mulai layanan/i });
    expect(screen.queryByRole('button', { name: /lengkapi data/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^selesai$|selesaikan/i })).not.toBeInTheDocument();
  });
});

describe('Admin antrian: Selesai hanya oleh pemilik (rpc layanan_selesai)', () => {
  it('pemilik, layanan tanpa pendataan: rpc layanan_selesai (bukan UPDATE visit) -> toast sukses', async () => {
    const mock = buildMock({ rows: [dilayaniSaya({ layanan: { nama: 'BPJS Kesehatan' } })] });
    render(<AntrianPage />);
    expect(screen.queryByRole('button', { name: /mulai layanan/i })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /^selesai$/i }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith('layanan_selesai', { p_tiket_id: 't-1' }));
    expect(mock._visitUpdate).not.toHaveBeenCalled();
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('Kunjungan berhasil diselesaikan', 'success'));
  });

  it('pemilik, layanan pendataan: Selesai dan Form Pendataan membuka wizard (tanpa RPC langsung)', async () => {
    const mock = buildMock({ rows: [dilayaniSaya()] });
    render(<AntrianPage />);
    expect(await screen.findByRole('button', { name: /form pendataan/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^selesai$/i }));
    await waitFor(() => expect(screen.getByTestId('pelayanan-wizard')).toHaveTextContent('Pendataan Pelayanan'));
    expect(mock.rpc.mock.calls.filter(([n]) => n === 'layanan_selesai')).toHaveLength(0);
    expect(screen.getByText('oleh Anda')).toBeInTheDocument();
  });

  it('bukan pemilik: tanpa Selesai / Form Pendataan; menyebut pemilik; Lihat Data tersedia (baca-saja)', async () => {
    buildMock({ rows: [dilayaniLain()], role: 'petugas', layananId: 'l-1' });
    render(<AntrianPage />);
    await screen.findByText('Budi');
    expect(screen.queryByRole('button', { name: /^selesai$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /form pendataan/i })).not.toBeInTheDocument();
    expect(screen.getByText('oleh Petugas Dua')).toBeInTheDocument();
    expect(screen.getByText(/Hanya Petugas Dua yang dapat menyelesaikan tiket ini/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /lihat data/i })).toBeInTheDocument();
    // Petugas tidak bisa ambil alih.
    expect(screen.queryByRole('button', { name: /ambil alih/i })).not.toBeInTheDocument();
  });

  it('pemilik tak terbaca (RLS) -> "petugas lain"', async () => {
    buildMock({ rows: [dilayaniLain({ pelayan: null })], role: 'petugas', layananId: 'l-1' });
    render(<AntrianPage />);
    expect(await screen.findByText('oleh petugas lain')).toBeInTheDocument();
  });

  it('BUKAN_PEMILIK dari DB (mis. baru diambil alih) -> pesan jelas dan daftar dimuat ulang', async () => {
    const mock = buildMock({
      rows: [dilayaniSaya({ layanan: { nama: 'BPJS Kesehatan' } })],
      rpc: { layanan_selesai: { data: null, error: { message: 'BUKAN_PEMILIK: tiket ini sedang dilayani petugas lain', code: '42501' } } },
    });
    render(<AntrianPage />);
    await screen.findByRole('button', { name: /^selesai$/i });
    const sebelum = jumlahMuat(mock);
    fireEvent.click(screen.getByRole('button', { name: /^selesai$/i }));
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('Hanya petugas yang memulai'), 'error'),
    );
    await waitFor(() => expect(jumlahMuat(mock)).toBeGreaterThan(sebelum));
    expect(toastMock).not.toHaveBeenCalledWith('Kunjungan berhasil diselesaikan', 'success');
  });

  it('Selesai: balasan kosong -> toast gagal, tanpa toast sukses', async () => {
    buildMock({ rows: [dilayaniSaya({ layanan: { nama: 'BPJS Kesehatan' } })], rpc: { layanan_selesai: { data: null, error: null } } });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /^selesai$/i }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('Gagal menyelesaikan antrian'), 'error'));
    expect(toastMock).not.toHaveBeenCalledWith('Kunjungan berhasil diselesaikan', 'success');
  });
});

describe('Admin antrian: Ambil alih (Admin, rpc admin_ambil_alih)', () => {
  it('Admin melihat "Ambil alih" pada tiket orang lain; dialog beralasan memanggil RPC lalu memuat ulang', async () => {
    const mock = buildMock({ rows: [dilayaniLain()], role: 'admin' });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /ambil alih/i }));

    const dialog = await screen.findByRole('dialog', { name: /Ambil alih tiket A-001/i });
    expect(within(dialog).getByText('Petugas Dua')).toBeInTheDocument();
    const alasan = within(dialog).getByLabelText(/Alasan ambil alih/i);

    // Alasan terlalu pendek -> galat aksesibel, RPC tidak dipanggil.
    fireEvent.change(alasan, { target: { value: 'abc' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Ambil alih$/i }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/minimal 5 karakter/i);
    expect(alasan).toHaveAttribute('aria-invalid', 'true');
    expect(mock.rpc.mock.calls.filter(([n]) => n === 'admin_ambil_alih')).toHaveLength(0);

    const sebelum = jumlahMuat(mock);
    fireEvent.change(alasan, { target: { value: '  petugas pulang sakit  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Ambil alih$/i }));
    await waitFor(() =>
      expect(mock.rpc).toHaveBeenCalledWith('admin_ambil_alih', { p_tiket_id: 't-1', p_alasan: 'petugas pulang sakit' }),
    );
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('kini menjadi tanggung jawab Anda'), 'success'));
    await waitFor(() => expect(jumlahMuat(mock)).toBeGreaterThan(sebelum));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('galat dari RPC ditampilkan di dialog (role=alert), dialog tetap terbuka', async () => {
    buildMock({
      rows: [dilayaniLain()],
      role: 'admin',
      rpc: { admin_ambil_alih: { data: null, error: { message: 'SESI_TIDAK_SAH: sesi tidak berlaku', code: '42501' } } },
    });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /ambil alih/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Alasan ambil alih/i), { target: { value: 'pemilik tidak di tempat' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Ambil alih$/i }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Sesi Anda sudah tidak berlaku/);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Escape menutup dialog', async () => {
    buildMock({ rows: [dilayaniLain()], role: 'admin' });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /ambil alih/i }));
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('tiket milik Admin sendiri: tanpa Ambil alih, dengan Selesai', async () => {
    buildMock({ rows: [dilayaniSaya()], role: 'admin' });
    render(<AntrianPage />);
    expect(await screen.findByRole('button', { name: /^selesai$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ambil alih/i })).not.toBeInTheDocument();
  });

  it('Front Office tidak melihat Ambil alih', async () => {
    buildMock({ rows: [dilayaniLain()], role: 'front_office' });
    render(<AntrianPage />);
    await screen.findByText('Budi');
    expect(screen.queryByRole('button', { name: /ambil alih/i })).not.toBeInTheDocument();
  });
});

describe('Admin antrian: Panggil (panggil_tiket, tidak berubah)', () => {
  const pesanDipanggil = (n: string) => expect.stringContaining(`Memanggil ${n}`);

  it('tiket bukan "menunggu" (RPC NULL tanpa error) -> toast gagal, bukan "Memanggil ..."', async () => {
    const mock = buildMock({ rows: [baseRow()], rpc: { panggil_tiket: { data: null, error: null } } });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /^panggil$/i }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith('panggil_tiket', { p_tiket_id: 't-1' }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('A-001'), 'error'));
    expect(toastMock).not.toHaveBeenCalledWith(pesanDipanggil('A-001'), 'success');
  });

  it('RPC error 42501 -> toast gagal', async () => {
    buildMock({ rows: [baseRow()], rpc: { panggil_tiket: { data: null, error: { message: 'tiket bukan milik layanan Anda', code: '42501' } } } });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /^panggil$/i }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('Gagal memanggil A-001'), 'error'));
  });

  it('berhasil -> toast "Memanggil ..."', async () => {
    buildMock({ rows: [baseRow()] });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /^panggil$/i }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(pesanDipanggil('A-001'), 'success'));
  });
});

describe('Admin antrian: koreksi data terkunci (tidak berubah)', () => {
  const selesai = () =>
    baseRow({ status: 'selesai', dilayani_oleh: SAYA, waktu_mulai_layan: new Date().toISOString(), waktu_selesai: new Date().toISOString() });

  it('Front Office melihat tombol Koreksi Data pada tiket selesai', async () => {
    buildMock({ rows: [selesai()], role: 'front_office' });
    render(<AntrianPage />);
    expect(await screen.findByRole('button', { name: /Koreksi Data/i })).toBeInTheDocument();
  });

  it('Admin melihat tombol Koreksi Data', async () => {
    buildMock({ rows: [selesai()], role: 'admin' });
    render(<AntrianPage />);
    expect(await screen.findByRole('button', { name: /Koreksi Data/i })).toBeInTheDocument();
  });

  it('Petugas tidak melihat tombol; hanya teks data terkunci', async () => {
    buildMock({ rows: [selesai()], role: 'petugas', layananId: 'l-1' });
    render(<AntrianPage />);
    expect(await screen.findByText(/Data sudah dikunci\. Hubungi Front Office atau Admin untuk koreksi\./i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Koreksi Data/i })).not.toBeInTheDocument();
  });

  it('tiket belum selesai tidak punya tombol koreksi', async () => {
    buildMock({ rows: [dilayaniLain()], role: 'front_office' });
    render(<AntrianPage />);
    await screen.findByText('Budi');
    expect(screen.queryByRole('button', { name: /Koreksi Data/i })).not.toBeInTheDocument();
  });
});
