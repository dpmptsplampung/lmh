// @vitest-environment jsdom
// Halaman antrean admin (A3, migrasi 202610140002_tiket_kepemilikan): transisi status lewat RPC atomik
// (layanan_mulai / layanan_selesai / admin_ambil_alih), BUKAN UPDATE langsung visit. Hanya pemilik tiket
// (dilayani_oleh) yang melihat tombol Selesai / Form Pendataan.
// B4 (migrasi 202610140004): tiket HASIL ESKALASI Front Office (penanganan_asal_id) menampilkan catatan FO, wajib topik +
// catatan saat selesai, "Kembalikan ke FO" (pemilik) dan "Alihkan" (Admin).
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
  penanganan_asal_id?: string | null;
  nomor: number;
  nomor_display: string;
  status: string;
  waktu_terbit: string | null;
  waktu_mulai_layan: string | null;
  waktu_selesai: string | null;
  layanan: { nama: string; form_pendataan?: string | null } | { nama: string; form_pendataan?: string | null }[];
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
  rpc?: Partial<Record<
    'panggil_tiket' | 'layanan_mulai' | 'layanan_selesai' | 'admin_ambil_alih' | 'layanan_kembalikan' | 'admin_alihkan',
    HasilRpc | Promise<HasilRpc>
  >>;
  // Baris penanganan tahap FO (kontrak §6.3), topik layanan tiket, dan layanan tujuan alih.
  penanganan?: Array<{ id: string; topik: string | null; catatan: string | null; penangan: { nama: string } | null }>;
  topik?: Array<{ id: string; nama: string }>;
  layananTujuan?: Array<{ id: string; nama: string }>;
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
    layanan_kembalikan: { data: { ok: true }, error: null },
    admin_alihkan: { data: { ok: true, nomor_display: 'BP-003', layanan_nama: 'BPJS Kesehatan', petugas_hadir: true }, error: null },
  };
  const rpc = vi.fn((nama: string) => {
    const atur = opts.rpc?.[nama as keyof NonNullable<typeof opts.rpc>];
    return Promise.resolve(atur ?? hasilDefault[nama] ?? { data: null, error: { message: 'tak dikenal' } });
  });

  // Rantai query "thenable" (select/eq/order/in mengembalikan dirinya; await -> hasil kaleng).
  const thenable = (hasil: { data: unknown; error: null }) => {
    const eq = vi.fn();
    const inFn = vi.fn();
    const p: Record<string, unknown> = {
      select: vi.fn(() => p),
      order: vi.fn(() => p),
      eq: eq.mockImplementation(() => p),
      in: inFn.mockImplementation(() => p),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(hasil).then(res, rej),
    };
    return { p, eq, inFn };
  };
  const penangananQ = thenable({ data: opts.penanganan ?? [], error: null });
  const topikQ = thenable({ data: opts.topik ?? [], error: null });
  const layananQ = thenable({ data: opts.layananTujuan ?? [], error: null });

  const mock = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },
    from: vi.fn((table: string) => {
      if (table === 'petugas') return { select: petugasSelect };
      if (table === 'tiket_antrean') return { select: tiketSelect };
      if (table === 'visit') return { update: visitUpdate };
      if (table === 'penanganan') return penangananQ.p;
      if (table === 'topik_penanganan') return topikQ.p;
      if (table === 'layanan') return layananQ.p;
      return {};
    }),
    rpc,
    _visitUpdate: visitUpdate,
    _tiketSelect: tiketSelect,
    _penangananIn: penangananQ.inFn,
    _topikEq: topikQ.eq,
    _layananEq: layananQ.eq,
  };

  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mock);
  return mock;
}

const baseRow = (over: Partial<AntrianRow> = {}): AntrianRow => ({
  id: 't-1',
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

  // Migrasi 202610140012: kewajiban form ditentukan kolom DB layanan.form_pendataan (bukan nama).
  it('form_pendataan DB menang atas nama: nama tanpa "OSS" tetapi wajib perizinan -> Selesai membuka wizard', async () => {
    const mock = buildMock({ rows: [dilayaniSaya({ layanan: { nama: 'Layanan Khusus', form_pendataan: 'perizinan' } })] });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /^selesai$/i }));
    await waitFor(() => expect(screen.getByTestId('pelayanan-wizard')).toBeInTheDocument());
    expect(mock.rpc.mock.calls.filter(([n]) => n === 'layanan_selesai')).toHaveLength(0);
  });

  it('form_pendataan DB kosong pada "Helpdesk OSS" -> tanpa Form Pendataan, Selesai memanggil RPC langsung', async () => {
    const mock = buildMock({ rows: [dilayaniSaya({ layanan: { nama: 'Helpdesk OSS', form_pendataan: null } })] });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /^selesai$/i }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith('layanan_selesai', { p_tiket_id: 't-1' }));
    expect(screen.queryByRole('button', { name: /form pendataan/i })).not.toBeInTheDocument();
  });

  it('kueri tiket memuat layanan.form_pendataan', async () => {
    const mock = buildMock({ rows: [dilayaniSaya()] });
    render(<AntrianPage />);
    await screen.findByRole('button', { name: /^selesai$/i });
    expect(String(mock._tiketSelect.mock.calls[0][0])).toMatch(/layanan:layanan_id\(nama, form_pendataan\)/);
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// B4: tiket hasil eskalasi Front Office (kontrak docs/analysis/FO-ESKALASI-KONTRAK-RPC.md)
// ─────────────────────────────────────────────────────────────────────────────────────────────
const eskalasi = (over: Partial<AntrianRow> = {}) => baseRow({ penanganan_asal_id: 'pn-fo', ...over });
const eskalasiSaya = (over: Partial<AntrianRow> = {}) => dilayaniSaya({ penanganan_asal_id: 'pn-fo', ...over });
const noBpjs = { nama: 'BPJS Kesehatan' };
const catatanFo = [{ id: 'pn-fo', topik: 'Pertanyaan BPJS', catatan: 'Pemohon menanyakan klaim rawat inap', penangan: { nama: 'Siti FO' } }];

describe('Admin antrian B4: catatan eskalasi dari Front Office', () => {
  it('tiket hasil eskalasi menampilkan topik, catatan, dan nama FO (kueri penanganan per id asal)', async () => {
    const mock = buildMock({ rows: [eskalasi()], penanganan: catatanFo });
    render(<AntrianPage />);
    expect(await screen.findByText('Eskalasi dari Front Office')).toBeInTheDocument();
    expect(await screen.findByText('Topik: Pertanyaan BPJS')).toBeInTheDocument();
    expect(screen.getByText('Pemohon menanyakan klaim rawat inap')).toBeInTheDocument();
    expect(screen.getByText('oleh Siti FO')).toBeInTheDocument();
    expect(String(mock._tiketSelect.mock.calls[0][0])).toMatch(/penanganan_asal_id/);
    expect(mock._penangananIn).toHaveBeenCalledWith('id', ['pn-fo']);
  });

  it('tiket lama (penanganan_asal_id null): tanpa blok eskalasi dan tanpa kueri penanganan', async () => {
    const mock = buildMock({ rows: [baseRow()] });
    render(<AntrianPage />);
    await screen.findByText('Budi');
    expect(screen.queryByText('Eskalasi dari Front Office')).not.toBeInTheDocument();
    expect(mock.from.mock.calls.some(([t]) => t === 'penanganan')).toBe(false);
  });

  it('catatan tidak terbaca (RLS/galat) tidak menggagalkan daftar: label eskalasi tetap tampil', async () => {
    const mock = buildMock({ rows: [eskalasi()] });
    mock._penangananIn.mockImplementation(() => { throw new Error('boom'); });
    render(<AntrianPage />);
    expect(await screen.findByText('Budi')).toBeInTheDocument();
    expect(screen.getByText('Eskalasi dari Front Office')).toBeInTheDocument();
    expect(screen.queryByText(/^Topik:/)).not.toBeInTheDocument();
  });
});

describe('Admin antrian B4: Selesai tiket eskalasi tanpa pendataan (layanan_selesai + topik + catatan)', () => {
  const buka = async (mock: ReturnType<typeof buildMock>) => {
    render(<AntrianPage />);
    const tombol = await screen.findByRole('button', { name: /^selesai$/i });
    fireEvent.click(tombol);
    const dialog = await screen.findByRole('dialog', { name: /Selesaikan tiket A-001/i });
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Klaim' })).toBeInTheDocument());
    return { dialog, tombol, mock };
  };

  it('membuka dialog (bukan RPC langsung); wajib topik dan catatan; lalu RPC 5 parameter', async () => {
    const mock = buildMock({
      rows: [eskalasiSaya({ layanan: noBpjs })],
      topik: [{ id: 'tp-1', nama: 'Klaim' }, { id: 'tp-2', nama: 'Lainnya' }],
    });
    const { dialog } = await buka(mock);
    expect(mock.rpc.mock.calls.filter(([n]) => n === 'layanan_selesai')).toHaveLength(0);
    expect(mock._topikEq).toHaveBeenCalledWith('layanan_id', 'l-1');
    expect(mock._topikEq).toHaveBeenCalledWith('aktif', true);

    // Kosong -> dua galat role=alert, RPC tidak dipanggil.
    fireEvent.click(within(dialog).getByRole('button', { name: /^Selesaikan$/ }));
    const galat = await within(dialog).findAllByRole('alert');
    expect(galat.map((g) => g.textContent).join(' ')).toMatch(/Topik penanganan wajib dipilih/);
    expect(galat.map((g) => g.textContent).join(' ')).toMatch(/Catatan wajib diisi/);
    expect(within(dialog).getByLabelText(/Topik penanganan/)).toHaveAttribute('aria-invalid', 'true');
    expect(mock.rpc.mock.calls.filter(([n]) => n === 'layanan_selesai')).toHaveLength(0);

    const sebelum = jumlahMuat(mock);
    fireEvent.change(within(dialog).getByLabelText(/Topik penanganan/), { target: { value: 'tp-1' } });
    fireEvent.change(within(dialog).getByLabelText(/Catatan penanganan/), { target: { value: '  Klaim dijelaskan  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Selesaikan$/ }));
    await waitFor(() =>
      expect(mock.rpc).toHaveBeenCalledWith('layanan_selesai', { p_tiket_id: 't-1', p_topik_id: 'tp-1', p_catatan: 'Klaim dijelaskan' }),
    );
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('selesai dilayani'), 'success'));
    await waitFor(() => expect(jumlahMuat(mock)).toBeGreaterThan(sebelum));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mock._visitUpdate).not.toHaveBeenCalled();
  });

  it('tombol dikunci selama request (klik ganda tidak memanggil RPC dua kali)', async () => {
    let selesaikan: (v: HasilRpc) => void = () => {};
    const tertunda = new Promise<HasilRpc>((r) => { selesaikan = r; });
    const mock = buildMock({ rows: [eskalasiSaya({ layanan: noBpjs })], topik: [{ id: 'tp-1', nama: 'Klaim' }], rpc: { layanan_selesai: tertunda } });
    const { dialog } = await buka(mock);
    fireEvent.change(within(dialog).getByLabelText(/Topik penanganan/), { target: { value: 'tp-1' } });
    fireEvent.change(within(dialog).getByLabelText(/Catatan penanganan/), { target: { value: 'ok' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Selesaikan$/ }));
    const sibuk = await within(dialog).findByRole('button', { name: /memproses/i });
    expect(sibuk).toBeDisabled();
    expect(sibuk).toHaveAttribute('aria-busy', 'true');
    fireEvent.submit(sibuk.closest('form')!);
    expect(mock.rpc.mock.calls.filter(([n]) => n === 'layanan_selesai')).toHaveLength(1);
    selesaikan({ data: { ok: true }, error: null });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it.each([
    ['TOPIK_TIDAK_VALID: topik bukan milik layanan tiket', /Topik yang dipilih tidak valid/],
    ['CATATAN_TERLALU_PANJANG: maksimal 1000 karakter', /Catatan terlalu panjang/],
    ['BUKAN_PEMILIK: tiket ini sedang dilayani petugas lain', /Hanya petugas yang memulai/],
    ['TIKET_LAMA: tiket alur visit', /alur lama/],
  ])('galat DB "%s" tampil jelas di dialog (role=alert) dan dialog tetap terbuka', async (pesanDb, pola) => {
    const mock = buildMock({
      rows: [eskalasiSaya({ layanan: noBpjs })],
      topik: [{ id: 'tp-1', nama: 'Klaim' }],
      rpc: { layanan_selesai: { data: null, error: { message: pesanDb, code: 'P0001' } } },
    });
    const { dialog } = await buka(mock);
    fireEvent.change(within(dialog).getByLabelText(/Topik penanganan/), { target: { value: 'tp-1' } });
    fireEvent.change(within(dialog).getByLabelText(/Catatan penanganan/), { target: { value: 'ok' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Selesaikan$/ }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(pola);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(toastMock).not.toHaveBeenCalledWith(expect.stringContaining('selesai dilayani'), 'success');
  });

  it('a11y: label terhubung, fokus awal ke isian, Tab berputar di dalam dialog, Escape menutup dan fokus kembali ke pemicu', async () => {
    const mock = buildMock({ rows: [eskalasiSaya({ layanan: noBpjs })], topik: [{ id: 'tp-1', nama: 'Klaim' }] });
    const { dialog, tombol } = await buka(mock);
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByLabelText(/Topik penanganan/)).toHaveFocus();

    const batal = within(dialog).getByRole('button', { name: 'Batal' });
    const kirim = within(dialog).getByRole('button', { name: /^Selesaikan$/ });
    kirim.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(within(dialog).getByRole('button', { name: 'Tutup' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(kirim).toHaveFocus();
    expect(batal).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(tombol).toHaveFocus();
  });

  it('tiket lama (bukan eskalasi) tanpa pendataan tetap langsung RPC tanpa topik/catatan', async () => {
    const mock = buildMock({ rows: [dilayaniSaya({ layanan: noBpjs })] });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /^selesai$/i }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith('layanan_selesai', { p_tiket_id: 't-1' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('tiket eskalasi dengan pendataan (Helpdesk OSS): Selesai membuka wizard, bukan dialog topik', async () => {
    buildMock({ rows: [eskalasiSaya()] });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /^selesai$/i }));
    await waitFor(() => expect(screen.getByTestId('pelayanan-wizard')).toHaveTextContent('Pendataan Pelayanan'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Admin antrian B4: Kembalikan ke FO (layanan_kembalikan)', () => {
  const bukaDialog = async (mock: ReturnType<typeof buildMock>) => {
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Kembalikan tiket A-001 ke Front Office/i }));
    const dialog = await screen.findByRole('dialog', { name: /Kembalikan A-001 ke Front Office/i });
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Klaim' })).toBeInTheDocument());
    return { dialog, mock };
  };

  it('hanya untuk pemilik tiket eskalasi yang sedang dilayani', async () => {
    // pemilik + eskalasi -> ada
    buildMock({ rows: [eskalasiSaya({ layanan: noBpjs })] });
    render(<AntrianPage />);
    expect(await screen.findByRole('button', { name: /Kembalikan tiket A-001/i })).toBeInTheDocument();
    cleanup();
    // pemilik tapi tiket lama -> tidak
    buildMock({ rows: [dilayaniSaya({ layanan: noBpjs })] });
    render(<AntrianPage />);
    await screen.findByRole('button', { name: /^selesai$/i });
    expect(screen.queryByRole('button', { name: /Kembalikan/i })).not.toBeInTheDocument();
    cleanup();
    // eskalasi tetapi dilayani orang lain (bahkan Admin) -> tidak
    buildMock({ rows: [dilayaniLain({ penanganan_asal_id: 'pn-fo' })], role: 'admin' });
    render(<AntrianPage />);
    await screen.findByText('Budi');
    expect(screen.queryByRole('button', { name: /Kembalikan/i })).not.toBeInTheDocument();
    cleanup();
    // eskalasi menunggu (belum dimulai) -> tidak
    buildMock({ rows: [eskalasi()] });
    render(<AntrianPage />);
    await screen.findByText('Budi');
    expect(screen.queryByRole('button', { name: /Kembalikan/i })).not.toBeInTheDocument();
  });

  it('catatan wajib; topik opsional; RPC dengan p_catatan dan p_topik_id; daftar dimuat ulang', async () => {
    const mock = buildMock({ rows: [eskalasiSaya({ layanan: noBpjs })], topik: [{ id: 'tp-1', nama: 'Klaim' }] });
    const { dialog } = await bukaDialog(mock);
    expect(within(dialog).getByLabelText(/Topik penanganan \(Opsional\)/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /^Kembalikan ke FO$/ }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Catatan wajib diisi/);
    expect(mock.rpc.mock.calls.filter(([n]) => n === 'layanan_kembalikan')).toHaveLength(0);

    const sebelum = jumlahMuat(mock);
    fireEvent.change(within(dialog).getByLabelText(/Alasan pengembalian/), { target: { value: '  Kebutuhan bukan di layanan ini  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Kembalikan ke FO$/ }));
    await waitFor(() =>
      expect(mock.rpc).toHaveBeenCalledWith('layanan_kembalikan', { p_tiket_id: 't-1', p_catatan: 'Kebutuhan bukan di layanan ini', p_topik_id: null }),
    );
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('dikembalikan ke Front Office'), 'success'));
    await waitFor(() => expect(jumlahMuat(mock)).toBeGreaterThan(sebelum));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('topik yang dipilih ikut dikirim', async () => {
    const mock = buildMock({ rows: [eskalasiSaya({ layanan: noBpjs })], topik: [{ id: 'tp-1', nama: 'Klaim' }] });
    const { dialog } = await bukaDialog(mock);
    fireEvent.change(within(dialog).getByLabelText(/Topik penanganan/), { target: { value: 'tp-1' } });
    fireEvent.change(within(dialog).getByLabelText(/Alasan pengembalian/), { target: { value: 'alasan' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Kembalikan ke FO$/ }));
    await waitFor(() =>
      expect(mock.rpc).toHaveBeenCalledWith('layanan_kembalikan', { p_tiket_id: 't-1', p_catatan: 'alasan', p_topik_id: 'tp-1' }),
    );
  });

  it('tombol dikunci selama request', async () => {
    let selesaikan: (v: HasilRpc) => void = () => {};
    const tertunda = new Promise<HasilRpc>((r) => { selesaikan = r; });
    const mock = buildMock({ rows: [eskalasiSaya({ layanan: noBpjs })], topik: [{ id: 'tp-1', nama: 'Klaim' }], rpc: { layanan_kembalikan: tertunda } });
    const { dialog } = await bukaDialog(mock);
    fireEvent.change(within(dialog).getByLabelText(/Alasan pengembalian/), { target: { value: 'alasan' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Kembalikan ke FO$/ }));
    const sibuk = await within(dialog).findByRole('button', { name: /memproses/i });
    expect(sibuk).toBeDisabled();
    fireEvent.submit(sibuk.closest('form')!);
    expect(mock.rpc.mock.calls.filter(([n]) => n === 'layanan_kembalikan')).toHaveLength(1);
    selesaikan({ data: { ok: true }, error: null });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it.each([
    ['TIKET_LAMA: tiket alur visit', /alur lama/, true],
    ['INVALID_STATUS: tiket tidak sedang dilayani', /Status tiket sudah berubah/, true],
    ['BUKAN_PEMILIK: bukan pemilik', /Hanya petugas yang memulai/, true],
    ['CATATAN_TERLALU_PANJANG: maksimal 1000', /Catatan terlalu panjang/, false],
    ['TOPIK_TIDAK_VALID: topik tidak valid', /Topik yang dipilih tidak valid/, false],
    ['SESI_TIDAK_SAH: sesi berakhir', /Sesi Anda sudah tidak berlaku/, false],
  ])('galat "%s" dipetakan ke pesan Indonesia (muat ulang daftar: %s)', async (pesanDb, pola, muatUlang) => {
    const mock = buildMock({
      rows: [eskalasiSaya({ layanan: noBpjs })],
      topik: [{ id: 'tp-1', nama: 'Klaim' }],
      rpc: { layanan_kembalikan: { data: null, error: { message: pesanDb, code: 'P0001' } } },
    });
    const { dialog } = await bukaDialog(mock);
    fireEvent.change(within(dialog).getByLabelText(/Alasan pengembalian/), { target: { value: 'alasan' } });
    const sebelum = jumlahMuat(mock);
    fireEvent.click(within(dialog).getByRole('button', { name: /^Kembalikan ke FO$/ }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(pola);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    if (muatUlang) await waitFor(() => expect(jumlahMuat(mock)).toBeGreaterThan(sebelum));
    else expect(jumlahMuat(mock)).toBe(sebelum);
  });
});

describe('Admin antrian B4: Alihkan (Admin, admin_alihkan)', () => {
  const layananTujuan = [
    { id: 'l-1', nama: 'Helpdesk OSS' }, // layanan tiket sendiri: tidak boleh jadi pilihan
    { id: 'l-2', nama: 'BPJS Kesehatan' },
    { id: 'l-3', nama: 'Bank Lampung' },
  ];

  const bukaDialog = async (mock: ReturnType<typeof buildMock>) => {
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Alihkan tiket A-001/i }));
    const dialog = await screen.findByRole('dialog', { name: /Alihkan tiket A-001/i });
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'BPJS Kesehatan' })).toBeInTheDocument());
    return { dialog, mock };
  };

  it('Admin melihat Alihkan pada tiket eskalasi menunggu, dilayani orang lain, dan dilayani sendiri', async () => {
    for (const baris of [eskalasi(), dilayaniLain({ penanganan_asal_id: 'pn-fo' }), eskalasiSaya()]) {
      buildMock({ rows: [baris], role: 'admin' });
      render(<AntrianPage />);
      expect(await screen.findByRole('button', { name: /Alihkan tiket A-001/i })).toBeInTheDocument();
      cleanup();
    }
    // Di samping Ambil alih yang sudah ada.
    buildMock({ rows: [dilayaniLain({ penanganan_asal_id: 'pn-fo' })], role: 'admin' });
    render(<AntrianPage />);
    expect(await screen.findByRole('button', { name: /^Ambil alih$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Alihkan tiket A-001/i })).toBeInTheDocument();
  });

  it('tidak tampil untuk tiket lama, tiket selesai, petugas, maupun Front Office', async () => {
    const kasus: Array<[AntrianRow, string]> = [
      [baseRow(), 'admin'],
      [dilayaniLain(), 'admin'],
      [eskalasi({ status: 'selesai', waktu_selesai: new Date().toISOString() }), 'admin'],
      [eskalasi(), 'petugas'],
      [eskalasiSaya(), 'petugas'],
      [eskalasi(), 'front_office'],
    ];
    for (const [baris, role] of kasus) {
      buildMock({ rows: [baris], role, layananId: role === 'petugas' ? 'l-1' : null });
      render(<AntrianPage />);
      await screen.findByText('Budi');
      expect(screen.queryByRole('button', { name: /Alihkan/i })).not.toBeInTheDocument();
      cleanup();
    }
  });

  it('memilih layanan tujuan (tanpa layanan asal) dan alasan wajib 5-500; RPC lalu daftar dimuat ulang', async () => {
    const mock = buildMock({ rows: [eskalasi()], role: 'admin', layananTujuan });
    const { dialog } = await bukaDialog(mock);
    expect(within(dialog).queryByRole('option', { name: 'Helpdesk OSS' })).not.toBeInTheDocument();
    expect(mock._layananEq).toHaveBeenCalledWith('punya_antrean', true);

    fireEvent.click(within(dialog).getByRole('button', { name: /^Alihkan$/ }));
    const galat = await within(dialog).findAllByRole('alert');
    expect(galat.map((g) => g.textContent).join(' ')).toMatch(/Pilih layanan tujuan/);
    expect(galat.map((g) => g.textContent).join(' ')).toMatch(/minimal 5 karakter/);
    expect(mock.rpc.mock.calls.filter(([n]) => n === 'admin_alihkan')).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText(/Layanan tujuan/), { target: { value: 'l-2' } });
    fireEvent.change(within(dialog).getByLabelText(/Alasan pengalihan/), { target: { value: 'abc' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Alihkan$/ }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/minimal 5 karakter/);
    expect(mock.rpc.mock.calls.filter(([n]) => n === 'admin_alihkan')).toHaveLength(0);

    const sebelum = jumlahMuat(mock);
    fireEvent.change(within(dialog).getByLabelText(/Alasan pengalihan/), { target: { value: '  salah pilih layanan  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Alihkan$/ }));
    await waitFor(() =>
      expect(mock.rpc).toHaveBeenCalledWith('admin_alihkan', { p_tiket_id: 't-1', p_layanan_tujuan: 'l-2', p_alasan: 'salah pilih layanan' }),
    );
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith('Tiket A-001 dialihkan ke BPJS Kesehatan (nomor baru BP-003)', 'success'),
    );
    await waitFor(() => expect(jumlahMuat(mock)).toBeGreaterThan(sebelum));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('petugas_hadir=false: pemberitahuan tambahan (bukan galat)', async () => {
    const mock = buildMock({
      rows: [eskalasi()], role: 'admin', layananTujuan,
      rpc: { admin_alihkan: { data: { ok: true, nomor_display: 'BP-003', layanan_nama: 'BPJS Kesehatan', petugas_hadir: false }, error: null } },
    });
    const { dialog } = await bukaDialog(mock);
    fireEvent.change(within(dialog).getByLabelText(/Layanan tujuan/), { target: { value: 'l-2' } });
    fireEvent.change(within(dialog).getByLabelText(/Alasan pengalihan/), { target: { value: 'alasan cukup' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Alihkan$/ }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('Belum ada petugas layanan tujuan'), 'info'));
  });

  it('tombol dikunci selama request', async () => {
    let selesaikan: (v: HasilRpc) => void = () => {};
    const tertunda = new Promise<HasilRpc>((r) => { selesaikan = r; });
    const mock = buildMock({ rows: [eskalasi()], role: 'admin', layananTujuan, rpc: { admin_alihkan: tertunda } });
    const { dialog } = await bukaDialog(mock);
    fireEvent.change(within(dialog).getByLabelText(/Layanan tujuan/), { target: { value: 'l-2' } });
    fireEvent.change(within(dialog).getByLabelText(/Alasan pengalihan/), { target: { value: 'alasan cukup' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Alihkan$/ }));
    const sibuk = await within(dialog).findByRole('button', { name: /memproses/i });
    expect(sibuk).toBeDisabled();
    expect(sibuk).toHaveAttribute('aria-busy', 'true');
    fireEvent.submit(sibuk.closest('form')!);
    expect(mock.rpc.mock.calls.filter(([n]) => n === 'admin_alihkan')).toHaveLength(1);
    selesaikan({ data: { ok: true, nomor_display: 'BP-003' }, error: null });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it.each([
    ['LAYANAN_SAMA: layanan tujuan sama', /Layanan tujuan sama dengan layanan tiket/, false],
    ['LAYANAN_TIDAK_VALID: layanan tidak aktif', /Layanan tujuan tidak valid/, false],
    ['ALASAN_WAJIB: alasan 5-500', /minimal 5 karakter/, false],
    ['TIKET_LAMA: tiket alur visit', /alur lama/, true],
    ['INVALID_STATUS: tiket sudah selesai', /Status tiket sudah berubah/, true],
    ['FORBIDDEN: hanya Admin', /tidak berwenang/, false],
    ['SESI_TIDAK_SAH: sesi berakhir', /Sesi Anda sudah tidak berlaku/, false],
    ['DIVERGENSI: visit tidak sinkron', /tidak sinkron/, false],
  ])('galat "%s" dipetakan ke pesan Indonesia di dialog (muat ulang daftar: %s)', async (pesanDb, pola, muatUlang) => {
    const mock = buildMock({
      rows: [eskalasi()], role: 'admin', layananTujuan,
      rpc: { admin_alihkan: { data: null, error: { message: pesanDb, code: 'P0001' } } },
    });
    const { dialog } = await bukaDialog(mock);
    fireEvent.change(within(dialog).getByLabelText(/Layanan tujuan/), { target: { value: 'l-2' } });
    fireEvent.change(within(dialog).getByLabelText(/Alasan pengalihan/), { target: { value: 'alasan cukup' } });
    const sebelum = jumlahMuat(mock);
    fireEvent.click(within(dialog).getByRole('button', { name: /^Alihkan$/ }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(pola);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    if (muatUlang) await waitFor(() => expect(jumlahMuat(mock)).toBeGreaterThan(sebelum));
    expect(toastMock).not.toHaveBeenCalledWith(expect.stringContaining('dialihkan'), 'success');
  });

  it('Escape menutup dan fokus kembali ke tombol pemicu', async () => {
    const mock = buildMock({ rows: [eskalasi()], role: 'admin', layananTujuan });
    render(<AntrianPage />);
    const pemicu = await screen.findByRole('button', { name: /Alihkan tiket A-001/i });
    pemicu.focus();
    fireEvent.click(pemicu);
    await screen.findByRole('dialog');
    expect(mock.rpc).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(pemicu).toHaveFocus();
  });
});
