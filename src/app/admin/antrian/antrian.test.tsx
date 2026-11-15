// @vitest-environment jsdom
// Halaman antrean admin (A3, migrasi 202610140002_tiket_kepemilikan): transisi status lewat RPC atomik
// (layanan_mulai / layanan_selesai / admin_ambil_alih), BUKAN UPDATE langsung visit. Hanya pemilik tiket
// (dilayani_oleh) yang melihat tombol Selesai / Form Pendataan.
// B4 (migrasi 202610140004): tiket HASIL ESKALASI Front Office (penanganan_asal_id) menampilkan catatan FO, wajib topik +
// catatan saat selesai, "Kembalikan ke FO" (pemilik) dan "Alihkan" (Admin).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within, act } from '@testing-library/react';

const toastMock = vi.hoisted(() => vi.fn());

// A13: tanggal/status/halaman ada di URL. Tes tabel memakai tab "Semua" (semua status tampil) kecuali dinyatakan lain.
const nav = vi.hoisted(() => ({ query: 'status=semua', replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => '/admin/antrian',
  useSearchParams: () => new URLSearchParams(nav.query),
}));

// Panel Sekarang (A1/A3) diuji terpisah (_bagian/PanelSekarang.test.tsx, antrian.panel.test.tsx): di sini dikosongkan agar nama
// pengunjung dan tombol Panggil/Mulai/Selesai panel tidak bertabrakan dengan pencarian pada tabel.
vi.mock('./_bagian/PanelSekarang', () => ({ default: () => null }));

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

// Tangkap fungsi muat ulang yang diberikan ke hook realtime (dipicu event/polling) agar bisa dipanggil dari tes.
const realtime = vi.hoisted(() => ({ refetch: null as null | (() => Promise<void>) }));
vi.mock('@/lib/hooks/useRealtimeRefetch', () => ({
  useRealtimeRefetch: (fn: () => Promise<void>) => { realtime.refetch = fn; },
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

// Mock PelayananWizardModal: teks "Pendataan Pelayanan" saat isOpen=true, "PendataanClosed" saat false. Tombol tiruan
// menyelesaikan wizard seperti komponen asli (onSuccess lalu onClose) untuk menguji dialog QR Pesan Perilaku.
vi.mock('@/components/admin/PelayananWizardModal', () => ({
  default: ({ isOpen, onSuccess, onClose }: { isOpen: boolean; onSuccess?: () => void; onClose: () => void }) => (
    <div data-testid="pelayanan-wizard">
      {isOpen ? 'Pendataan Pelayanan' : 'PendataanClosed'}
      {isOpen && (
        <button type="button" onClick={() => { onSuccess?.(); onClose(); }}>Kunci data (tiruan)</button>
      )}
    </div>
  ),
}));

// Kanvas QR tidak berjalan di jsdom: tiruan mengekspos nilai yang dikodekan lewat atribut (bukan teks).
vi.mock('@/components/QRCode', () => ({
  default: ({ value }: { value: string }) => <div data-testid="qr" data-value={value} />,
}));

import AntrianPage from './page';
import { createClient } from '@/lib/supabase/client';
import { addDaysWIB, todayWIB } from '@/lib/time';
import { formatTanggal } from '@/lib/utils';

type AntrianRow = {
  id: string;
  kunjungan_id: string;
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
    'fo_antrean_daftar' | 'panggil_tiket' | 'layanan_mulai' | 'layanan_selesai' | 'admin_ambil_alih' | 'layanan_kembalikan' | 'admin_alihkan'
    | 'ambil_qr_survei',
    HasilRpc | Promise<HasilRpc>
  >>;
  // Baris penanganan tahap FO (kontrak §6.3), topik layanan tiket, dan layanan tujuan alih.
  penanganan?: Array<{ id: string; topik: string | null; catatan: string | null; penangan: { nama: string } | null }>;
  topik?: Array<{ id: string; nama: string }>;
  layananTujuan?: Array<{ id: string; nama: string }>;
  // Baris v_survei_status (Pesan Perilaku) per kunjungan; 'galat' = kueri gagal.
  survei?: Array<{ kunjungan_id: string; status: string }> | 'galat';
  /** Fase 3: penanda Koordinator akun pemanggil (dibaca terpisah lewat petugas.select('koordinator')). */
  koordinator?: boolean;
} = {}) {
  const rows = opts.rows ?? [];
  const role = opts.role ?? 'admin';
  const layananId = opts.layananId === undefined ? (role === 'petugas' ? 'l-1' : null) : opts.layananId;

  const range = vi.fn().mockResolvedValue({ data: rows, count: rows.length });
  const inStatus = vi.fn().mockReturnValue({ range, eq: vi.fn().mockReturnValue({ range }) });
  const order = vi.fn().mockReturnValue({ range, in: inStatus, eq: vi.fn().mockReturnValue({ range }) });
  // Kueri statistik: bisa di-await dan masih bisa disambung .eq('layanan_id', ...) (rantai Supabase asli).
  const hasilStats = (): Promise<{ data: AntrianRow[]; count: number }> & { eq: () => unknown } =>
    Object.assign(Promise.resolve({ data: rows, count: rows.length }), { eq: () => hasilStats() });
  const statsEq = vi.fn(() => hasilStats());
  const eqTanggal = vi.fn().mockReturnValue({ order, eq: statsEq });
  const tiketSelect = vi.fn().mockReturnValue({ eq: eqTanggal });

  const petugasSingle = vi.fn().mockResolvedValue({
    data: { id: SAYA, role, layanan_id: layananId, layanan: { nama: 'Helpdesk OSS' } },
    error: null,
  });
  const petugasEq = vi.fn().mockReturnValue({
    single: petugasSingle,
    maybeSingle: vi.fn().mockResolvedValue({ data: { koordinator: opts.koordinator ?? false }, error: null }),
  });
  const petugasSelect = vi.fn().mockReturnValue({ eq: petugasEq });

  // visit TIDAK boleh lagi di-UPDATE oleh halaman ini (A3): spy untuk membuktikannya.
  const visitUpdate = vi.fn();

  const hasilDefault: Record<string, HasilRpc> = {
    // RPC akses FO (migrasi 202611030015) belum ada: halaman memakai kueri lama (perilaku sebelum migrasi).
    fo_antrean_daftar: { data: null, error: { code: 'PGRST202', message: 'fungsi tidak ada' } },
    panggil_tiket: { data: 'A-001', error: null },
    layanan_mulai: { data: { ok: true, sudah_milik_anda: false }, error: null },
    layanan_selesai: { data: { ok: true, is_locked: false }, error: null },
    admin_ambil_alih: { data: { ok: true, sudah_milik_anda: false }, error: null },
    koordinator_ambil_alih_tiket: { data: { ok: true, sudah_milik_anda: false }, error: null },
    layanan_kembalikan: { data: { ok: true }, error: null },
    admin_alihkan: { data: { ok: true, nomor_display: 'BP-003', layanan_nama: 'BPJS Kesehatan', petugas_hadir: true }, error: null },
    // Default: kunjungan tanpa undangan -> dialog QR menutup diri tanpa tampil (tidak mengganggu tes lain).
    ambil_qr_survei: { data: { status: 'tidak_ada', token: null, kedaluwarsa_pada: null, unit: null, layanan_nama: null }, error: null },
  };
  const rpc = vi.fn((nama: string) => {
    const atur = opts.rpc?.[nama as keyof NonNullable<typeof opts.rpc>];
    return Promise.resolve(atur ?? hasilDefault[nama] ?? { data: null, error: { message: 'tak dikenal' } });
  });

  // Rantai query "thenable" (select/eq/order/in mengembalikan dirinya; await -> hasil kaleng).
  const thenable = (hasil: { data: unknown; error: DbError | null }) => {
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
  const surveiQ = thenable(
    opts.survei === 'galat' ? { data: null, error: { message: 'boom' } } : { data: opts.survei ?? [], error: null },
  );

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
      if (table === 'v_survei_status') return surveiQ.p;
      return {};
    }),
    rpc,
    _visitUpdate: visitUpdate,
    _range: range,
    _inStatus: inStatus,
    _tiketSelect: tiketSelect,
    _penangananIn: penangananQ.inFn,
    _topikEq: topikQ.eq,
    _layananEq: layananQ.eq,
    _survei: surveiQ,
  };

  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mock);
  return mock;
}

const baseRow = (over: Partial<AntrianRow> = {}): AntrianRow => ({
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
  realtime.refetch = null;
  nav.query = 'status=semua';
});

afterEach(() => {
  cleanup();
});

// ── Pemilih tanggal (PemilihTanggal): chip membuka kisi kalender; hari berlabel "4 November 2026[, ...]" ──
const labelHari = (iso: string) => formatTanggal(`${iso}T12:00:00+07:00`);
const chipTanggal = () => screen.getByRole('button', { name: /^Tanggal antrean:/ });
/** Dengan kisi terbuka: pindah bulan (maks 3) sampai hari yang dicari tampil, lalu kembalikan tombolnya. */
async function bukaHari(iso: string): Promise<HTMLElement> {
  const cari = () => screen.queryByRole('button', { name: new RegExp(`^${labelHari(iso)}`) });
  for (let i = 0; i < 3 && !cari(); i++) {
    const [y, m] = iso.split('-').map(Number);
    const sekarang = new Date();
    const lampau = y < sekarang.getFullYear() || (y === sekarang.getFullYear() && m < sekarang.getMonth() + 1);
    fireEvent.click(screen.getByRole('button', { name: lampau ? 'Bulan sebelumnya' : 'Bulan berikutnya' }));
  }
  const hari = cari();
  if (!hari) throw new Error(`hari ${iso} tidak ditemukan di kisi`);
  return hari;
}
async function pilihHari(iso: string) {
  fireEvent.click(chipTanggal());
  fireEvent.click(await bukaHari(iso));
}

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
    expect(kolom).toMatch(/kunjungan_id/);
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

  // Keputusan CEO 2026-10-14: Admin pengambil alih TIDAK boleh menutup tanpa form (pengecualian 0012 dihapus).
  it('Admin pemilik setelah ambil alih, layanan wajib form: Selesai membuka wizard (tidak ada jalur tutup tanpa form)', async () => {
    const mock = buildMock({
      role: 'admin',
      rows: [dilayaniSaya({ layanan: { nama: 'Helpdesk OSS', form_pendataan: 'oss' }, pelayan: { nama: 'Admin Satu' } })],
    });
    render(<AntrianPage />);
    expect(await screen.findByRole('button', { name: /form pendataan/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^selesai$/i }));
    await waitFor(() => expect(screen.getByTestId('pelayanan-wizard')).toHaveTextContent('Pendataan Pelayanan'));
    expect(mock.rpc.mock.calls.filter(([n]) => n === 'layanan_selesai')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /tanpa (form|pendataan)/i })).not.toBeInTheDocument();
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
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('Gagal menyelesaikan antrean'), 'error'));
    expect(toastMock).not.toHaveBeenCalledWith('Kunjungan berhasil diselesaikan', 'success');
  });
});

describe('Antrian: ambil alih oleh Koordinator Petugas Layanan (Fase 3)', () => {
  it('Koordinator melihat "Ambil alih" pada tiket rekan di layanannya dan memanggil koordinator_ambil_alih_tiket', async () => {
    const mock = buildMock({ rows: [dilayaniLain()], role: 'petugas', koordinator: true });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /ambil alih/i }));
    const dialog = await screen.findByRole('dialog', { name: /Ambil alih tiket A-001/i });
    expect(within(dialog).getByText(/Petugas semula tetap dapat menyunting draf/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/Alasan ambil alih/i), { target: { value: 'petugas izin mendadak' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Ambil alih$/i }));
    await waitFor(() =>
      expect(mock.rpc).toHaveBeenCalledWith('koordinator_ambil_alih_tiket', { p_tiket_id: 't-1', p_alasan: 'petugas izin mendadak' }),
    );
    expect(mock.rpc.mock.calls.filter(([n]) => n === 'admin_ambil_alih')).toHaveLength(0);
  });

  it('Petugas biasa (bukan Koordinator) tidak melihat tombol Ambil alih', async () => {
    buildMock({ rows: [dilayaniLain()], role: 'petugas', koordinator: false });
    render(<AntrianPage />);
    await screen.findByText('A-001');
    expect(screen.queryByRole('button', { name: /ambil alih/i })).not.toBeInTheDocument();
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

  // Layar TV: tiap klik sukses = satu kejadian panggilan baru. Jeda hanya menahan klik ganda tak sengaja.
  it('klik beruntun cepat hanya satu panggilan; setelah jeda tombol aktif lagi dan klik berikutnya memanggil ulang', async () => {
    const mock = buildMock({ rows: [baseRow()] });
    render(<AntrianPage />);
    const tombol = await screen.findByRole('button', { name: /^panggil$/i });
    fireEvent.click(tombol);
    fireEvent.click(tombol);
    fireEvent.click(tombol);
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(pesanDipanggil('A-001'), 'success'));
    const panggilan = () => mock.rpc.mock.calls.filter(([n]) => n === 'panggil_tiket').length;
    expect(panggilan()).toBe(1);
    // Umpan balik tampak pada tombol selama jeda.
    expect(screen.getByRole('button', { name: /terpanggil/i })).toBeDisabled();

    const lagi = await screen.findByRole('button', { name: /^panggil$/i }, { timeout: 4000 });
    expect(lagi).toBeEnabled();
    fireEvent.click(lagi);
    await waitFor(() => expect(panggilan()).toBe(2));
    await waitFor(() => expect(toastMock.mock.calls.filter(([m, t]) => m === 'Memanggil A-001…' && t === 'success')).toHaveLength(2));
  });

  it('panggilan gagal tidak menahan tombol: bisa dicoba lagi segera', async () => {
    const mock = buildMock({ rows: [baseRow()], rpc: { panggil_tiket: { data: null, error: { message: 'x', code: '42501' } } } });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /^panggil$/i }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('Gagal memanggil A-001'), 'error'));
    const lagi = await screen.findByRole('button', { name: /^panggil$/i });
    expect(lagi).toBeEnabled();
    fireEvent.click(lagi);
    await waitFor(() => expect(mock.rpc.mock.calls.filter(([n]) => n === 'panggil_tiket')).toHaveLength(2));
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
    // Membuka dialog tidak memanggil RPC mutasi apa pun (pemuatan daftar lewat fo_antrean_daftar tidak dihitung).
    expect(mock.rpc.mock.calls.filter(([n]) => n !== 'fo_antrean_daftar')).toHaveLength(0);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(pemicu).toHaveFocus();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Pesan Perilaku (survei terpadu): dialog QR setelah tiket selesai (tiga jalur) + lencana status di baris selesai
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('Admin antrian: QR Pesan Perilaku setelah tiket selesai', () => {
  const TOKEN = 'f9a0'.repeat(16);
  const qrBelumDiisi: HasilRpc = {
    data: { status: 'belum_diisi', token: TOKEN, kedaluwarsa_pada: '2026-10-28T03:30:00+00:00', unit: 'layanan', layanan_nama: 'BPJS Kesehatan' },
    error: null,
  };
  const panggilanQr = (mock: ReturnType<typeof buildMock>) => mock.rpc.mock.calls.filter(([n]) => n === 'ambil_qr_survei');

  const tampilQr = async () => {
    const dialog = await screen.findByRole('dialog', { name: 'QR Pesan Perilaku' });
    expect(within(dialog).getByTestId('qr').getAttribute('data-value')).toMatch(new RegExp(`/survei/${TOKEN}$`));
    // Token hanya sebagai QR: tidak pernah menjadi teks.
    expect(document.body.textContent).not.toContain(TOKEN);
    return dialog;
  };

  it('jalur 1, layanan_selesai langsung: dialog dibuka untuk kunjungan_id tiket itu', async () => {
    const mock = buildMock({
      rows: [dilayaniSaya({ layanan: { nama: 'BPJS Kesehatan' }, kunjungan_id: 'k-9' })],
      rpc: { ambil_qr_survei: qrBelumDiisi },
    });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /^selesai$/i }));

    const dialog = await tampilQr();
    expect(mock.rpc).toHaveBeenCalledWith('ambil_qr_survei', { p_kunjungan_id: 'k-9' });
    expect(within(dialog).getByText('BPJS Kesehatan')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tutup' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('jalur 2, PelayananWizardModal selesai: dialog dibuka untuk kunjungan_id tiket yang dikunci', async () => {
    const mock = buildMock({
      rows: [dilayaniSaya({ kunjungan_id: 'k-8' })],
      rpc: { ambil_qr_survei: qrBelumDiisi },
    });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /^selesai$/i }));
    // Wizard tiruan terbuka; menyelesaikannya memanggil onSuccess lalu onClose (urutan komponen asli).
    fireEvent.click(await screen.findByRole('button', { name: 'Kunci data (tiruan)' }));

    await tampilQr();
    expect(mock.rpc).toHaveBeenCalledWith('ambil_qr_survei', { p_kunjungan_id: 'k-8' });
    expect(screen.getByTestId('pelayanan-wizard')).toHaveTextContent('PendataanClosed');
  });

  it('jalur 3, SelesaiEskalasiModal: dialog dibuka untuk kunjungan_id tiket eskalasi', async () => {
    const mock = buildMock({
      rows: [eskalasiSaya({ layanan: noBpjs, kunjungan_id: 'k-7' })],
      topik: [{ id: 'tp-1', nama: 'Klaim' }],
      rpc: { ambil_qr_survei: qrBelumDiisi },
    });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /^selesai$/i }));
    const form = await screen.findByRole('dialog', { name: /Selesaikan tiket A-001/i });
    await waitFor(() => expect(within(form).getByRole('option', { name: 'Klaim' })).toBeInTheDocument());
    fireEvent.change(within(form).getByLabelText(/Topik penanganan/), { target: { value: 'tp-1' } });
    fireEvent.change(within(form).getByLabelText(/Catatan penanganan/), { target: { value: 'Klaim dijelaskan' } });
    fireEvent.click(within(form).getByRole('button', { name: /^Selesaikan$/ }));

    await tampilQr();
    expect(mock.rpc).toHaveBeenCalledWith('ambil_qr_survei', { p_kunjungan_id: 'k-7' });
    expect(screen.queryByRole('dialog', { name: /Selesaikan tiket/ })).toBeNull();
  });

  it('tanpa token (kunjungan belum selesai / tanpa undangan): RPC dipanggil tetapi tidak ada dialog', async () => {
    const mock = buildMock({ rows: [dilayaniSaya({ layanan: { nama: 'BPJS Kesehatan' }, kunjungan_id: 'k-9' })] });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /^selesai$/i }));

    await waitFor(() => expect(panggilanQr(mock)).toHaveLength(1));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('Kunjungan berhasil diselesaikan', 'success'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('qr')).toBeNull();
  });

  it('galat RPC QR: pesan singkat dengan tombol Tutup, tanpa penolakan tak tertangani; penyelesaian tetap sukses', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    buildMock({
      rows: [dilayaniSaya({ layanan: { nama: 'BPJS Kesehatan' }, kunjungan_id: 'k-9' })],
      rpc: { ambil_qr_survei: { data: null, error: { message: 'boom', code: '42501' } } },
    });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /^selesai$/i }));

    const dialog = await screen.findByRole('dialog', { name: 'QR Pesan Perilaku' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/belum dapat dimuat/i);
    expect(toastMock).toHaveBeenCalledWith('Kunjungan berhasil diselesaikan', 'success');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tutup' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    spy.mockRestore();
  });
});

describe('Admin antrian: lencana status Pesan Perilaku pada tiket selesai', () => {
  const TOKEN = '0b1c'.repeat(16);
  const selesaiRow = (id: string, kunjunganId: string, nomor: number) =>
    baseRow({
      id, kunjungan_id: kunjunganId, nomor, nomor_display: `A-00${nomor}`, status: 'selesai', dilayani_oleh: SAYA,
      waktu_mulai_layan: '2026-10-27T02:00:00.000Z', waktu_selesai: '2026-10-27T02:10:00.000Z',
      kunjungan: { nama: `Pengunjung ${nomor}`, asal: 'walk_in', waktu_masuk: '2026-10-27T01:55:00.000Z' },
    });
  const barisTiket = (nomor: string) => screen.getByText(nomor).closest('tr')!;

  it('lencana per kunjungan selesai; tombol Tampilkan QR hanya untuk Belum diisi; tanpa undangan = "—"; status sekali per muat', async () => {
    const mock = buildMock({
      rows: [
        selesaiRow('t-1', 'k-1', 1),
        selesaiRow('t-2', 'k-2', 2),
        selesaiRow('t-3', 'k-3', 3),
        selesaiRow('t-4', 'k-4', 4),
        dilayaniLain({ id: 't-5', kunjungan_id: 'k-5', nomor: 5, nomor_display: 'A-005' }),
      ],
      survei: [
        { kunjungan_id: 'k-1', status: 'belum_diisi' },
        { kunjungan_id: 'k-2', status: 'sudah_diisi' },
        { kunjungan_id: 'k-3', status: 'kedaluwarsa' },
      ],
    });
    render(<AntrianPage />);
    await screen.findByText('A-001');
    await waitFor(() => expect(within(barisTiket('A-001')).getByText('Belum diisi')).toBeInTheDocument());

    expect(within(barisTiket('A-001')).getByText('Pesan Perilaku')).toBeInTheDocument();
    expect(within(barisTiket('A-001')).getByRole('button', { name: /Tampilkan QR Pesan Perilaku tiket A-001/ })).toBeInTheDocument();
    expect(within(barisTiket('A-002')).getByText('Sudah diisi')).toBeInTheDocument();
    expect(within(barisTiket('A-003')).getByText('Kedaluwarsa')).toBeInTheDocument();
    expect(within(barisTiket('A-004')).getByTitle('Belum ada undangan Pesan Perilaku')).toBeInTheDocument();
    for (const nomor of ['A-002', 'A-003', 'A-004', 'A-005']) {
      expect(within(barisTiket(nomor)).queryByRole('button', { name: /Tampilkan QR/ })).toBeNull();
    }
    // Tiket belum selesai: tanpa lencana.
    expect(within(barisTiket('A-005')).queryByText('Pesan Perilaku')).toBeNull();

    // Sekali per muat data, hanya untuk kunjungan dengan tiket selesai.
    expect(mock._survei.inFn).toHaveBeenCalledTimes(1);
    expect(mock._survei.inFn).toHaveBeenCalledWith('kunjungan_id', ['k-1', 'k-2', 'k-3', 'k-4']);
    expect(mock.from.mock.calls.filter(([t]) => t === 'v_survei_status')).toHaveLength(1);
  });

  it('Tampilkan QR membuka dialog untuk kunjungan baris itu', async () => {
    const mock = buildMock({
      rows: [selesaiRow('t-1', 'k-1', 1), selesaiRow('t-2', 'k-2', 2)],
      survei: [{ kunjungan_id: 'k-1', status: 'sudah_diisi' }, { kunjungan_id: 'k-2', status: 'belum_diisi' }],
      rpc: {
        ambil_qr_survei: {
          data: { status: 'belum_diisi', token: TOKEN, kedaluwarsa_pada: '2026-10-28T03:30:00+00:00', unit: 'layanan', layanan_nama: 'Helpdesk OSS' },
          error: null,
        },
      },
    });
    render(<AntrianPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Tampilkan QR Pesan Perilaku tiket A-002/ }));

    const dialog = await screen.findByRole('dialog', { name: 'QR Pesan Perilaku' });
    expect(mock.rpc).toHaveBeenCalledWith('ambil_qr_survei', { p_kunjungan_id: 'k-2' });
    expect(within(dialog).getByTestId('qr').getAttribute('data-value')).toMatch(new RegExp(`/survei/${TOKEN}$`));
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  it('galat memuat status tidak menggagalkan daftar: tanpa lencana dan tanpa toast galat', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    buildMock({ rows: [selesaiRow('t-1', 'k-1', 1)], survei: 'galat' });
    render(<AntrianPage />);
    expect(await screen.findByText('Pengunjung 1')).toBeInTheDocument();
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(screen.queryByText('Pesan Perilaku')).toBeNull();
    expect(toastMock).not.toHaveBeenCalledWith('Gagal memuat data antrian', 'error');
    spy.mockRestore();
  });
});

describe('Admin antrian: B-01 muat ulang senyap + C-10 label filter', () => {
  const tunda = <T,>() => {
    let selesai!: (v: T) => void;
    const p = new Promise<T>((r) => { selesai = r; });
    return { p, selesai };
  };

  it('realtime/polling menyegarkan tanpa skeleton: baris dan tombol aksi tetap ada selama muat ulang', async () => {
    const mock = buildMock({ rows: [baseRow({ nomor_display: 'A-001' })], role: 'admin' });
    const { container } = render(<AntrianPage />);
    await screen.findByText('Budi');
    const gerbang = tunda<{ data: AntrianRow[]; count: number }>();
    mock._range.mockReturnValueOnce(gerbang.p);

    let selesai!: Promise<void>;
    await waitFor(() => expect(realtime.refetch).not.toBeNull());
    act(() => { selesai = realtime.refetch!(); });

    // Sedang menunggu respons: tabel lama masih terpasang, skeleton tidak muncul.
    expect(container.querySelector('.skeleton')).toBeNull();
    expect(screen.getByText('Budi')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Panggil/ })).toBeInTheDocument();

    gerbang.selesai({ data: [baseRow({ nomor_display: 'A-001' }), baseRow({ id: 't-2', nomor: 2, nomor_display: 'A-002', kunjungan: { nama: 'Siti', asal: 'walk_in', waktu_masuk: new Date().toISOString() } })], count: 2 });
    await act(async () => { await selesai; });
    expect(await screen.findByText('Siti')).toBeInTheDocument();
    expect(container.querySelector('.skeleton')).toBeNull();
  });

  it('muat ulang senyap tidak membaca profil petugas lagi (getUser sekali)', async () => {
    const mock = buildMock({ rows: [baseRow()], role: 'admin' });
    render(<AntrianPage />);
    await screen.findByText('Budi');
    expect(mock.auth.getUser).toHaveBeenCalledTimes(1);
    const sebelum = jumlahMuat(mock);
    await act(async () => { await realtime.refetch!(); });
    expect(jumlahMuat(mock)).toBeGreaterThan(sebelum); // data dimuat ulang
    expect(mock.auth.getUser).toHaveBeenCalledTimes(1); // profil tidak
  });

  it('respons lama tidak menimpa respons yang lebih baru (nomor permintaan)', async () => {
    const mock = buildMock({ rows: [baseRow()], role: 'admin' });
    render(<AntrianPage />);
    await screen.findByText('Budi');
    const lama = tunda<{ data: AntrianRow[]; count: number }>();
    const baru = tunda<{ data: AntrianRow[]; count: number }>();
    mock._range.mockReturnValueOnce(lama.p).mockReturnValueOnce(baru.p);
    let a!: Promise<void>;
    let b!: Promise<void>;
    act(() => { a = realtime.refetch!(); });
    act(() => { b = realtime.refetch!(); });
    const baris = (nama: string) => [baseRow({ kunjungan: { nama, asal: 'walk_in', waktu_masuk: new Date().toISOString() } })];
    baru.selesai({ data: baris('Terbaru'), count: 1 });
    await act(async () => { await b; });
    lama.selesai({ data: baris('Basi'), count: 1 });
    await act(async () => { await a; });
    expect(screen.getByText('Terbaru')).toBeInTheDocument();
    expect(screen.queryByText('Basi')).toBeNull();
  });

  it('muat awal gagal -> galat + Coba lagi (bukan "Belum Ada Antrean"); Coba lagi memulihkan', async () => {
    const mock = buildMock({ rows: [baseRow()], role: 'admin' });
    mock._range.mockResolvedValueOnce({ data: null, count: null, error: { message: 'TypeError: Failed to fetch' } });
    render(<AntrianPage />);
    expect(await screen.findByText(/Antrean tidak dapat dimuat/)).toBeInTheDocument();
    expect(screen.queryByText('Belum Ada Antrean')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(await screen.findByText('Budi')).toBeInTheDocument();
    expect(screen.queryByText(/Antrean tidak dapat dimuat/)).toBeNull();
  });

  it('muat ulang senyap gagal -> data lama tetap tampil + catatan pembaruan gagal (tanpa toast berulang)', async () => {
    const mock = buildMock({ rows: [baseRow()], role: 'admin' });
    render(<AntrianPage />);
    await screen.findByText('Budi');
    mock._range.mockResolvedValueOnce({ data: null, count: null, error: { message: 'TypeError: Failed to fetch' } });
    await act(async () => { await realtime.refetch!(); });
    expect(screen.getByText('Budi')).toBeInTheDocument();
    expect(screen.getByText(/Pembaruan terakhir gagal/)).toBeInTheDocument();
    expect(toastMock).not.toHaveBeenCalledWith(expect.stringContaining('Gagal memuat'), 'error');
    // muat ulang berikutnya berhasil -> catatan hilang
    await act(async () => { await realtime.refetch!(); });
    expect(screen.queryByText(/Pembaruan terakhir gagal/)).toBeNull();
  });

  it('ganti tanggal tetap menampilkan skeleton (data tanggal lain tak boleh tampak seperti tanggal baru)', async () => {
    const mock = buildMock({ rows: [baseRow()], role: 'admin' });
    const { container } = render(<AntrianPage />);
    await screen.findByText('Budi');
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    const gerbang = tunda<{ data: AntrianRow[]; count: number }>();
    mock._range.mockReturnValueOnce(gerbang.p);
    await pilihHari(addDaysWIB(-1));
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull());
    gerbang.selesai({ data: [], count: 0 });
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
  });

  it('C-10: pemilih tanggal punya nama aksesibel dan menampilkan tanggal yang dipilih', async () => {
    buildMock({ rows: [baseRow()], role: 'admin' });
    render(<AntrianPage />);
    await screen.findByText('Budi');
    expect(chipTanggal()).toHaveAccessibleName(`Tanggal antrean: ${formatTanggal(`${todayWIB()}T12:00:00+07:00`)}`);
  });
});

describe('Admin antrian: A13 tanggal, status, dan halaman di URL', () => {
  it('memilih tanggal menulis ?tanggal= lewat router.replace (tanpa riwayat) dan memuat tanggal itu', async () => {
    const mock = buildMock({ rows: [baseRow()], role: 'admin' });
    render(<AntrianPage />);
    await screen.findByText('Budi');
    await pilihHari(addDaysWIB(-1));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(
      `/admin/antrian?tanggal=${addDaysWIB(-1)}&status=semua`, { scroll: false },
    ));
    await waitFor(() => expect(mock._tiketSelect.mock.results[0].value.eq).toHaveBeenCalledWith('tanggal', addDaysWIB(-1)));
  });

  it('?tanggal= dari URL menjadi tanggal awal; tanggal rusak jatuh ke hari ini', async () => {
    nav.query = `status=semua&tanggal=${addDaysWIB(-2)}`;
    const mock = buildMock({ rows: [baseRow()], role: 'admin' });
    render(<AntrianPage />);
    await screen.findByText('Budi');
    expect(mock._tiketSelect.mock.results[0].value.eq).toHaveBeenCalledWith('tanggal', addDaysWIB(-2));
    expect(chipTanggal()).toHaveTextContent(/.+/);
    cleanup();
    nav.query = 'status=semua&tanggal=2026-02-30';
    const mock2 = buildMock({ rows: [baseRow()], role: 'admin' });
    render(<AntrianPage />);
    await screen.findByText('Budi');
    expect(mock2._tiketSelect.mock.results[0].value.eq).toHaveBeenCalledWith('tanggal', todayWIB());
  });

  it('bawaan = tab Aktif: kueri memakai .in(status, [menunggu, dilayani]); URL polos tidak ditulis ulang', async () => {
    nav.query = '';
    const mock = buildMock({ rows: [baseRow()], role: 'admin' });
    render(<AntrianPage />);
    await screen.findByText('Budi');
    expect(mock._inStatus).toHaveBeenCalledWith('status', ['menunggu', 'dilayani']);
    expect(screen.getByRole('tab', { name: 'Aktif' })).toHaveAttribute('aria-selected', 'true');
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('tab Selesai: .in(status, [selesai]) dan ?status=selesai ditulis ke URL; tab Semua tanpa .in', async () => {
    nav.query = '';
    const mock = buildMock({ rows: [baseRow()], role: 'admin' });
    render(<AntrianPage />);
    await screen.findByText('Budi');
    fireEvent.click(screen.getByRole('tab', { name: 'Selesai' }));
    await waitFor(() => expect(mock._inStatus).toHaveBeenCalledWith('status', ['selesai']));
    expect(nav.replace).toHaveBeenLastCalledWith('/admin/antrian?status=selesai', { scroll: false });
    mock._inStatus.mockClear();
    fireEvent.click(screen.getByRole('tab', { name: 'Semua' }));
    await waitFor(() => expect(nav.replace).toHaveBeenLastCalledWith('/admin/antrian?status=semua', { scroll: false }));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Semua' })).toHaveAttribute('aria-selected', 'true'));
    // Tab Semua tidak menyaring tabel; satu .in hanya milik sumber panel aktif yang terpisah.
    expect(mock._inStatus).toHaveBeenCalledTimes(1);
    expect(mock._inStatus).toHaveBeenCalledWith('status', ['menunggu', 'dilayani']);
    fireEvent.click(screen.getByRole('tab', { name: 'Aktif' }));
    await waitFor(() => expect(nav.replace).toHaveBeenLastCalledWith('/admin/antrian', { scroll: false }));
  });

  it('?status=selesai dari URL membuka tab Selesai; tab kosong menjelaskan alasannya (bukan galat)', async () => {
    nav.query = 'status=selesai';
    buildMock({ rows: [], role: 'admin' });
    render(<AntrianPage />);
    expect(await screen.findByText('Belum ada tiket selesai')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Selesai' })).toHaveAttribute('aria-selected', 'true');
  });

  it('jalur RPC FO (tanpa p_status): saringan Aktif diterapkan sebelum paginasi tanpa catatan saringan parsial', async () => {
    nav.query = '';
    const { legacy_visit_id: _l, ...dasar } = baseRow() as AntrianRow;
    void _l;
    const aktif = { ...dasar, status: 'menunggu', fo_nama: 'Rina FO' };
    const selesai = { ...dasar, id: 't-2', nomor: 2, nomor_display: 'A-002', status: 'selesai', fo_nama: 'Rina FO', kunjungan: { nama: 'Sari', asal: 'walk_in', waktu_masuk: null } };
    buildMock({
      role: 'front_office',
      rpc: { fo_antrean_daftar: { data: { rows: [aktif, selesai], total: 2, statistik: { totalSelesai: 1, rataWaktuMenit: 3 } }, error: null } },
    });
    render(<AntrianPage />);
    expect(await screen.findByText('Budi')).toBeInTheDocument();
    expect(screen.queryByText('Sari')).toBeNull();
    expect(screen.queryByText(/Saringan status berlaku pada halaman ini saja/)).toBeNull();
    expect(screen.getByText('Total Tiket').parentElement!.parentElement).toHaveTextContent('2');
  });
});

describe('Admin antrian: RPC fo_antrean_daftar (akses FO, migrasi 202611030015)', () => {
  const barisRpc = (over: Record<string, unknown> = {}) => {
    const { legacy_visit_id: _l, ...dasar } = baseRow() as AntrianRow;
    void _l;
    return { ...dasar, fo_nama: 'Rina FO', ...over };
  };
  const halaman = (rows: unknown[], over: Record<string, unknown> = {}) => ({
    data: { rows, total: rows.length, statistik: { totalSelesai: 7, rataWaktuMenit: 9 }, ...over },
    error: null,
  });

  it('Admin/FO membaca lewat RPC: tanggal, halaman, kolom Front Office dari fo_nama, statistik dari RPC; tanpa kueri tiket_antrean', async () => {
    const mock = buildMock({
      role: 'front_office',
      rpc: { fo_antrean_daftar: halaman([barisRpc(), barisRpc({ id: 't-2', nomor: 2, nomor_display: 'A-002', fo_nama: null })]) },
    });
    render(<AntrianPage />);
    expect(await screen.findByText('Rina FO')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Front Office' })).toBeInTheDocument();
    const panggilan = (mock.rpc.mock.calls as unknown as Array<[string, Record<string, unknown>]>).find(([n]) => n === 'fo_antrean_daftar')!;
    expect(panggilan[1]).toMatchObject({ p_batas: 25, p_lewati: 0, p_layanan_id: null });
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(jumlahMuat(mock)).toBe(0);
  });

  it('fo_nama kosong ditulis tanda hubung; nomor, nama, dan status tetap tampil', async () => {
    buildMock({ role: 'admin', rpc: { fo_antrean_daftar: halaman([barisRpc({ fo_nama: null })]) } });
    render(<AntrianPage />);
    const baris = (await screen.findByText('Budi')).closest('tr')!;
    expect(within(baris).getByText('A-001')).toBeInTheDocument();
    expect(within(baris).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('Petugas tidak pernah memanggil RPC FO (kueri lama berlingkup Layanannya) dan tanpa kolom Front Office', async () => {
    const mock = buildMock({ role: 'petugas', layananId: 'l-1', rows: [baseRow()] });
    render(<AntrianPage />);
    await screen.findByText('Budi');
    expect(mock.rpc.mock.calls.some(([n]) => n === 'fo_antrean_daftar')).toBe(false);
    expect(screen.queryByRole('columnheader', { name: 'Front Office' })).toBeNull();
  });

  it('RPC belum ada: kueri lama tetap jalan tanpa kolom Front Office', async () => {
    const mock = buildMock({ role: 'admin', rows: [baseRow()] });
    render(<AntrianPage />);
    expect(await screen.findByText('Budi')).toBeInTheDocument();
    expect(jumlahMuat(mock)).toBeGreaterThan(0);
    expect(screen.queryByRole('columnheader', { name: 'Front Office' })).toBeNull();
  });

  it('RPC ditolak (FORBIDDEN): tampil gagal memuat, bukan antrean kosong dan bukan kueri lama', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const mock = buildMock({
      role: 'front_office', rows: [baseRow()],
      rpc: { fo_antrean_daftar: { data: null, error: { code: '42501', message: 'FORBIDDEN: bukan staf' } } },
    });
    render(<AntrianPage />);
    expect(await screen.findByText(/tidak dapat dimuat/i)).toBeInTheDocument();
    expect(screen.queryByText('Belum Ada Antrean')).toBeNull();
    expect(jumlahMuat(mock)).toBe(0);
    spy.mockRestore();
  });
});

describe('Admin antrian: jendela tanggal Front Office non-Koordinator', () => {
  const kosong = { data: { rows: [], total: 0, statistik: { totalSelesai: 0, rataWaktuMenit: 0 } }, error: null };
  const panggilanFo = (mock: ReturnType<typeof buildMock>) =>
    (mock.rpc.mock.calls as unknown as Array<[string, Record<string, unknown>]>).filter(([n]) => n === 'fo_antrean_daftar');

  it('FO biasa: hari di luar hari ini-7 s.d. hari ini+1 tidak tersedia di pemilih; hari di dalam jendela memanggil server', async () => {
    const mock = buildMock({ role: 'front_office', koordinator: false, rpc: { fo_antrean_daftar: kosong } });
    render(<AntrianPage />);
    await waitFor(() => expect(panggilanFo(mock).length).toBeGreaterThan(0));
    // profil dibaca sebelum pemilih mendapat batas: tunggu sampai hari di luar jendela benar-benar nonaktif
    // Kalender menolak pindah ke bulan yang seluruhnya di luar batas, jadi hari uji harus ada di kisi bulan berjalan.
    // Salah satu dari dua calon di luar jendela ini selalu sebulan dengan hari ini.
    fireEvent.click(chipTanggal());
    const bulanIni = todayWIB().slice(0, 7);
    const hariLuar = [addDaysWIB(-8), addDaysWIB(2)].find((iso) => iso.startsWith(bulanIni)) as string;
    const luar = await bukaHari(hariLuar);
    await waitFor(() => expect(luar).toHaveAttribute('aria-disabled', 'true'));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    const awal = panggilanFo(mock).length;
    await pilihHari(addDaysWIB(1));
    await waitFor(() => expect(panggilanFo(mock).length).toBe(awal + 1));
    expect(panggilanFo(mock)[awal][1]).toMatchObject({ p_tanggal: addDaysWIB(1) });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Admin, FO Koordinator, dan Petugas: tanggal bebas (hari lampau tersedia di pemilih)', async () => {
    for (const opsi of [
      { role: 'admin' }, { role: 'front_office', koordinator: true }, { role: 'petugas', layananId: 'l-1' },
    ] as const) {
      cleanup();
      buildMock({ ...opsi, rows: [baseRow()], rpc: { fo_antrean_daftar: kosong } });
      render(<AntrianPage />);
      await waitFor(() => expect(chipTanggal()).toBeInTheDocument());
      await new Promise((r) => setTimeout(r, 30));
      fireEvent.click(chipTanggal());
      const hari = await bukaHari(addDaysWIB(-30));
      expect(hari).not.toHaveAttribute('aria-disabled', 'true');
    }
  });

  it('galat TANGGAL_DILUAR_BATAS dari server tampil sebagai pesan jelas, bukan "periksa koneksi"', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    buildMock({
      role: 'front_office',
      rpc: { fo_antrean_daftar: { data: null, error: { code: '22023', message: 'TANGGAL_DILUAR_BATAS: x' } } },
    });
    render(<AntrianPage />);
    expect(await screen.findByText(/7 hari ke belakang sampai besok/)).toBeInTheDocument();
    expect(screen.queryByText(/Periksa koneksi/)).toBeNull();
    spy.mockRestore();
  });
});
