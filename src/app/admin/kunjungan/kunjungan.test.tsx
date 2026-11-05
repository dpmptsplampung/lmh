// @vitest-environment jsdom
// Kelola Kunjungan: kolom "Front Office" = nama FO yang melayani tiap kunjungan (keputusan CEO 2026-10-14: semua FO
// melihat semua pengunjung, dengan nama FO yang melayani; RLS migrasi 202610140013). Nama FO = pelengkap: kegagalan
// memuatnya tidak menggagalkan daftar.
// Kolom "Pesan Perilaku" (survei terpadu): lencana status (v_survei_status) untuk kunjungan selesai + tombol "Tampilkan QR"
// hanya untuk status "Belum diisi".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent, waitFor, act } from '@testing-library/react';
import { buatH, punyaOp, type FakeH, type Op } from '@/test/fo-supabase-mock';

const m = vi.hoisted(() => ({ toast: vi.fn(), h: null as unknown as FakeH, query: '', router: { replace: vi.fn() } }));

vi.mock('next/navigation', () => ({
  useRouter: () => m.router,
  usePathname: () => '/admin/kunjungan',
  useSearchParams: () => new URLSearchParams(m.query),
}));

vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: m.toast }) }));
vi.mock('@/components/layout/PageHeader', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/lib/hooks/useRealtimeRefetch', () => ({ useRealtimeRefetch: vi.fn() }));
vi.mock('@/lib/supabase/client', async () => {
  const { buatFakeSupabase } = await import('@/test/fo-supabase-mock');
  return { createClient: () => buatFakeSupabase(m.h) };
});
// Kanvas QR tidak berjalan di jsdom: tiruan mengekspos nilai yang dikodekan lewat atribut (bukan teks).
vi.mock('@/components/QRCode', () => ({
  default: ({ value }: { value: string }) => <div data-testid="qr" data-value={value} />,
}));

import KunjunganPage from './page';
import { useRealtimeRefetch } from '@/lib/hooks/useRealtimeRefetch';
import { addDaysWIB, todayWIB } from '@/lib/time';

function pilihTanggal(tanggal: string) {
  fireEvent.click(screen.getByRole('button', { name: /^Tanggal kunjungan:/ }));
  const dialog = screen.getByRole('dialog', { name: 'Tanggal kunjungan' });
  const saatIni = todayWIB();
  const bulan = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7));
  const beda = bulan(tanggal) - bulan(saatIni);
  for (let i = 0; i < Math.abs(beda); i++) fireEvent.click(within(dialog).getByRole('button', { name: beda < 0 ? 'Bulan sebelumnya' : 'Bulan berikutnya' }));
  fireEvent.click(dialog.querySelector<HTMLButtonElement>(`button[data-tanggal="${tanggal}"]`)!);
}

// Fungsi muat ulang yang diberikan halaman ke hook realtime (dipicu event/polling).
const refetchRealtime = () => {
  const panggilan = vi.mocked(useRealtimeRefetch).mock.calls;
  return panggilan[panggilan.length - 1][0] as () => Promise<void>;
};
// Hasil kueri yang baru terselesaikan setelah gerbang dibuka (thenable di dalam HasilFake; Promise.resolve menyerapnya).
const tertunda = <T,>(hasil: T) => {
  let buka!: () => void;
  const gerbang = new Promise<void>((r) => { buka = r; });
  const thenable = { then: (res: (v: T) => unknown, rej?: (e: unknown) => unknown) => gerbang.then(() => hasil).then(res, rej) };
  return { thenable: thenable as unknown as ReturnType<typeof kunjungan>, buka };
};

const kunjungan = (id: string, nama: string, status = 'selesai') => ({
  id, nama, asal: 'walk_in', status, waktu_masuk: '2026-10-13T02:00:00.000Z', tanggal: '2026-10-13',
  tiket_antrean: [],
});

// RPC akses FO (migrasi 202611030015) belum ada: halaman memakai kueri lama (perilaku sebelum migrasi).
const rpcBelumAda = () => ({ data: null, error: { code: 'PGRST202', message: 'fungsi tidak ada' } });

// Ganti hasil RPC lain (mis. ambil_qr_survei) tanpa mengusik RPC akses FO yang tetap "belum ada".
const atur = (fn: (nama: string, args: Record<string, unknown>) => ReturnType<FakeH['rpc']>) => {
  m.h.rpc = (nama, args) => (nama.startsWith('fo_') ? rpcBelumAda() : fn(nama, args));
};
const rpcQr = () => m.h.rpcLog.filter((l) => !l.nama.startsWith('fo_'));

beforeEach(() => {
  m.query = '';
  m.router.replace.mockReset();
  m.router.replace.mockImplementation((url: string) => { m.query = url.split('?')[1] ?? ''; });
  m.h = buatH();
  m.h.rpc = rpcBelumAda;
  m.toast.mockClear();
  m.h.tabel.kunjungan = { data: [kunjungan('k-1', 'Budi'), kunjungan('k-2', 'Dewi'), kunjungan('k-3', 'Eko')], error: null, count: 3 };
});
afterEach(cleanup);

describe('Kelola Kunjungan: nama Front Office', () => {
  it('menampilkan nama FO (semua FO, termasuk FO lain; beberapa FO digabung) per kunjungan', async () => {
    m.h.tabel.penanganan = {
      data: [
        { kunjungan_id: 'k-1', tahap_ke: 1, penangan_id: 'fo-a', penangan: { nama: 'Ani FO' } },
        { kunjungan_id: 'k-2', tahap_ke: 1, penangan_id: 'fo-b', penangan: [{ nama: 'Bayu FO' }] },
        { kunjungan_id: 'k-2', tahap_ke: 3, penangan_id: 'fo-a', penangan: { nama: 'Ani FO' } },
      ],
      error: null,
    };
    render(<KunjunganPage />);
    const tabel = await screen.findByRole('table');
    expect(within(tabel).getByRole('columnheader', { name: 'Front Office' })).toBeInTheDocument();
    const baris = (nama: string) => within(tabel).getByText(nama).closest('tr')!;
    expect(within(baris('Budi')).getByText('Ani FO')).toBeInTheDocument();
    expect(within(baris('Dewi')).getByText('Bayu FO, Ani FO')).toBeInTheDocument();
    const kolomFo = within(tabel).getAllByRole('columnheader').findIndex((th) => th.textContent === 'Front Office');
    expect(baris('Eko').querySelectorAll('td')[kolomFo].textContent).toBe('—');

    const kueri = m.h.log.find((l) => l.tabel === 'penanganan')!;
    expect(punyaOp(kueri.ops, 'in', 'kunjungan_id', ['k-1', 'k-2', 'k-3'])).toBe(true);
    expect(punyaOp(kueri.ops, 'eq', 'peran_tahap', 'fo')).toBe(true);
    // Tidak dipersempit ke FO pemanggil.
    expect(kueri.ops.some(([op, a]) => op === 'eq' && a[0] === 'penangan_id')).toBe(false);
  });

  it('galat memuat nama FO tidak menggagalkan daftar kunjungan', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    m.h.tabel.penanganan = (_ops: Op[]) => ({ data: null, error: { message: 'boom' } });
    render(<KunjunganPage />);
    expect(await screen.findByText('Budi')).toBeInTheDocument();
    expect(m.toast).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('Kelola Kunjungan: Pesan Perilaku (survei terpadu)', () => {
  const TOKEN = 'e7f8'.repeat(16);
  const baris = (tabel: HTMLElement, nama: string) => within(tabel).getByText(nama).closest('tr')!;

  it('lencana status per kunjungan selesai; tombol Tampilkan QR hanya untuk Belum diisi; tanpa undangan = "—"', async () => {
    m.h.tabel.v_survei_status = {
      data: [
        { kunjungan_id: 'k-1', status: 'belum_diisi' },
        { kunjungan_id: 'k-2', status: 'sudah_diisi' },
      ],
      error: null,
    };
    render(<KunjunganPage />);
    const tabel = await screen.findByRole('table');
    expect(within(tabel).getByRole('columnheader', { name: 'Pesan Perilaku' })).toBeInTheDocument();
    const kolom = within(tabel).getAllByRole('columnheader').findIndex((th) => th.textContent === 'Pesan Perilaku');

    await waitFor(() => expect(within(baris(tabel, 'Budi')).getByText('Belum diisi')).toBeInTheDocument());
    expect(within(baris(tabel, 'Budi')).getByRole('button', { name: /Tampilkan QR Pesan Perilaku untuk Budi/ })).toBeInTheDocument();
    expect(within(baris(tabel, 'Dewi')).getByText('Sudah diisi')).toBeInTheDocument();
    expect(within(baris(tabel, 'Dewi')).queryByRole('button', { name: /Tampilkan QR/ })).toBeNull();
    expect(baris(tabel, 'Eko').querySelectorAll('td')[kolom].textContent).toBe('—');
    expect(within(baris(tabel, 'Eko')).queryByRole('button', { name: /Tampilkan QR/ })).toBeNull();
  });

  it('status Kedaluwarsa tanpa tombol QR', async () => {
    m.h.tabel.v_survei_status = { data: [{ kunjungan_id: 'k-1', status: 'kedaluwarsa' }], error: null };
    render(<KunjunganPage />);
    const tabel = await screen.findByRole('table');
    await waitFor(() => expect(within(baris(tabel, 'Budi')).getByText('Kedaluwarsa')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Tampilkan QR/ })).toBeNull();
  });

  it('status diambil sekali per muat data, hanya untuk kunjungan selesai', async () => {
    m.h.tabel.kunjungan = {
      data: [kunjungan('k-1', 'Budi'), kunjungan('k-2', 'Dewi', 'menunggu'), kunjungan('k-3', 'Eko', 'dilayani')],
      error: null,
      count: 3,
    };
    m.h.tabel.v_survei_status = { data: [{ kunjungan_id: 'k-1', status: 'belum_diisi' }], error: null };
    render(<KunjunganPage />);
    const tabel = await screen.findByRole('table');
    await waitFor(() => expect(within(baris(tabel, 'Budi')).getByText('Belum diisi')).toBeInTheDocument());

    const kueri = m.h.log.filter((l) => l.tabel === 'v_survei_status');
    expect(kueri).toHaveLength(1);
    expect(punyaOp(kueri[0].ops, 'in', 'kunjungan_id', ['k-1'])).toBe(true);
    // Kunjungan belum selesai: tidak ada lencana.
    const kolom = within(tabel).getAllByRole('columnheader').findIndex((th) => th.textContent === 'Pesan Perilaku');
    expect(baris(tabel, 'Dewi').querySelectorAll('td')[kolom].textContent).toBe('—');
  });

  it('Tampilkan QR membuka dialog QR Pesan Perilaku untuk kunjungan itu (token hanya sebagai QR)', async () => {
    m.h.tabel.v_survei_status = { data: [{ kunjungan_id: 'k-2', status: 'belum_diisi' }], error: null };
    atur(() => ({
      data: { status: 'belum_diisi', token: TOKEN, kedaluwarsa_pada: '2026-10-14T11:00:00.000Z', unit: 'layanan', layanan_nama: 'Helpdesk OSS' },
      error: null,
    }));
    render(<KunjunganPage />);
    const tabel = await screen.findByRole('table');
    fireEvent.click(await within(baris(tabel, 'Dewi')).findByRole('button', { name: /Tampilkan QR Pesan Perilaku untuk Dewi/ }));

    const dialog = await screen.findByRole('dialog', { name: 'QR Pesan Perilaku' });
    expect(rpcQr()).toEqual([{ nama: 'ambil_qr_survei', args: { p_kunjungan_id: 'k-2' } }]);
    expect(within(dialog).getByTestId('qr').getAttribute('data-value')).toMatch(new RegExp(`/survei/${TOKEN}$`));
    expect(within(dialog).getByText('Helpdesk OSS')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(TOKEN);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Tutup' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('status yang berubah jadi Sudah diisi saat tombol diklik: dialog menutup diri tanpa tampil', async () => {
    m.h.tabel.v_survei_status = { data: [{ kunjungan_id: 'k-1', status: 'belum_diisi' }], error: null };
    atur(() => ({
      data: { status: 'sudah_diisi', token: null, kedaluwarsa_pada: '2026-10-14T11:00:00.000Z', unit: 'fo', layanan_nama: null },
      error: null,
    }));
    render(<KunjunganPage />);
    const tabel = await screen.findByRole('table');
    fireEvent.click(await within(baris(tabel, 'Budi')).findByRole('button', { name: /Tampilkan QR/ }));
    await waitFor(() => expect(rpcQr()).toHaveLength(1));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('qr')).toBeNull();
  });

  it('galat memuat status tidak menggagalkan daftar: tanpa lencana, tanpa toast galat', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    m.h.tabel.v_survei_status = { data: null, error: { message: 'boom' } };
    render(<KunjunganPage />);
    const tabel = await screen.findByRole('table');
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(within(tabel).getByText('Budi')).toBeInTheDocument();
    expect(screen.queryByText('Belum diisi')).toBeNull();
    expect(screen.queryByRole('button', { name: /Tampilkan QR/ })).toBeNull();
    expect(m.toast).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('Kelola Kunjungan: B-01 muat ulang senyap + C-10 label filter', () => {
  it('Refresh/realtime menyegarkan tanpa skeleton: daftar tetap tampil selama muat ulang', async () => {
    render(<KunjunganPage />);
    await screen.findByText('Budi');
    const { thenable, buka } = tertunda({
      data: [kunjungan('k-1', 'Budi'), kunjungan('k-9', 'Baru')], error: null, count: 2,
    });
    m.h.tabel.kunjungan = () => thenable as never;

    let selesai!: Promise<void>;
    act(() => { selesai = refetchRealtime()(); });
    expect(screen.queryByText('Memuat Daftar kunjungan')).toBeNull();
    expect(screen.getByText('Budi')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Refresh/ })).toBeDisabled();

    buka();
    await act(async () => { await selesai; });
    expect(await screen.findByText('Baru')).toBeInTheDocument();
    expect(screen.queryByText('Memuat Daftar kunjungan')).toBeNull();
    expect(screen.getByRole('button', { name: /Refresh/ })).not.toBeDisabled();
  });

  it('respons lama tidak menimpa respons yang lebih baru', async () => {
    render(<KunjunganPage />);
    await screen.findByText('Budi');
    const lama = tertunda({ data: [kunjungan('k-5', 'Basi')], error: null, count: 1 });
    const baru = tertunda({ data: [kunjungan('k-6', 'Terbaru')], error: null, count: 1 });
    const antrean = [lama.thenable, baru.thenable];
    m.h.tabel.kunjungan = (ops) => (ops.some(([k]) => k === 'range') ? (antrean.shift() as never) : ({ data: [], error: null } as never));
    let a!: Promise<void>;
    let b!: Promise<void>;
    act(() => { a = refetchRealtime()(); });
    act(() => { b = refetchRealtime()(); });
    baru.buka();
    await act(async () => { await b; });
    lama.buka();
    await act(async () => { await a; });
    expect(screen.getByText('Terbaru')).toBeInTheDocument();
    expect(screen.queryByText('Basi')).toBeNull();
  });

  it('muat awal gagal -> galat + Coba lagi, bukan "Tidak Ada Data"; Coba lagi memulihkan', async () => {
    m.h.tabel.kunjungan = { data: null as never, error: { message: 'TypeError: Failed to fetch' }, count: null as never };
    render(<KunjunganPage />);
    expect(await screen.findByText(/Data kunjungan tidak dapat dimuat/)).toBeInTheDocument();
    expect(screen.queryByText('Tidak Ada Data')).toBeNull();
    m.h.tabel.kunjungan = { data: [kunjungan('k-1', 'Budi')], error: null, count: 1 };
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(await screen.findByText('Budi')).toBeInTheDocument();
    expect(screen.queryByText(/Data kunjungan tidak dapat dimuat/)).toBeNull();
  });

  it('muat ulang senyap gagal -> daftar lama tetap + catatan, tanpa toast; berhasil lagi -> catatan hilang', async () => {
    render(<KunjunganPage />);
    await screen.findByText('Budi');
    m.h.tabel.kunjungan = { data: null as never, error: { message: 'TypeError: Failed to fetch' }, count: null as never };
    await act(async () => { await refetchRealtime()(); });
    expect(screen.getByText('Budi')).toBeInTheDocument();
    expect(screen.getByText(/Pembaruan terakhir gagal/)).toBeInTheDocument();
    expect(m.toast).not.toHaveBeenCalled();
    m.h.tabel.kunjungan = { data: [kunjungan('k-1', 'Budi')], error: null, count: 1 };
    await act(async () => { await refetchRealtime()(); });
    expect(screen.queryByText(/Pembaruan terakhir gagal/)).toBeNull();
  });

  it('ganti tanggal tetap menampilkan skeleton', async () => {
    render(<KunjunganPage />);
    await screen.findByText('Budi');
    const { thenable, buka } = tertunda({ data: [], error: null, count: 0 });
    m.h.tabel.kunjungan = (ops) => (ops.some(([k]) => k === 'range') ? (thenable as never) : ({ data: [], error: null } as never));
    pilihTanggal(addDaysWIB(-1));
    await waitFor(() => expect(screen.queryByText('Memuat Daftar kunjungan')).not.toBeNull());
    buka();
    await waitFor(() => expect(screen.queryByText('Memuat Daftar kunjungan')).toBeNull());
  });

  it('C-10: pencarian dan tanggal punya nama aksesibel', async () => {
    render(<KunjunganPage />);
    await screen.findByText('Budi');
    expect((screen.getByLabelText('Cari nama atau layanan') as HTMLInputElement).type).toBe('text');
    expect(screen.getByRole('button', { name: /^Tanggal kunjungan:/ })).toHaveAttribute('aria-haspopup', 'dialog');
  });
});

describe('Kelola Kunjungan: RPC fo_kunjungan_daftar (akses FO, migrasi 202611030015)', () => {
  const barisRpc = (id: string, nama: string, fo: string | null) => ({
    id, nama, asal: 'walk_in', status: 'selesai', waktu_masuk: '2026-10-13T02:00:00.000Z', tanggal: '2026-10-13',
    fo_nama: fo,
    tiket_antrean: [{ nomor_display: 'A-001', waktu_selesai: null, layanan: { nama: 'Helpdesk OSS' } }],
  });

  it('memakai RPC dengan tanggal dan halaman; nama FO dari fo_nama tanpa membaca tabel kunjungan/penanganan', async () => {
    m.h.rpc = (nama) => (nama === 'fo_kunjungan_daftar'
      ? { data: { rows: [barisRpc('k-1', 'Budi', 'Ani FO'), barisRpc('k-2', 'Dewi', null)], total: 2 }, error: null }
      : { data: null, error: null });
    render(<KunjunganPage />);
    const tabel = await screen.findByRole('table');
    const baris = (nama: string) => within(tabel).getByText(nama).closest('tr')!;
    expect(within(baris('Budi')).getByText('Ani FO')).toBeInTheDocument();
    const kolomFo = within(tabel).getAllByRole('columnheader').findIndex((th) => th.textContent === 'Front Office');
    expect(baris('Dewi').querySelectorAll('td')[kolomFo].textContent).toBe('—');
    expect(within(baris('Budi')).getByText('A-001')).toBeInTheDocument();
    const panggilan = m.h.rpcLog.find((l) => l.nama === 'fo_kunjungan_daftar')!;
    expect(panggilan.args).toMatchObject({ p_batas: 25, p_lewati: 0 });
    expect(m.h.log.some((l) => l.tabel === 'kunjungan' || l.tabel === 'penanganan')).toBe(false);
  });

  it('galat RPC (bukan objek belum ada) tampil sebagai gagal memuat, bukan daftar kosong atau kueri lama', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    m.h.rpc = () => ({ data: null, error: { code: '42501', message: 'FORBIDDEN: bukan staf' } });
    render(<KunjunganPage />);
    expect(await screen.findByText(/tidak dapat dimuat/i)).toBeInTheDocument();
    expect(screen.queryByText('Tidak Ada Data')).toBeNull();
    expect(m.h.log.some((l) => l.tabel === 'kunjungan')).toBe(false);
    spy.mockRestore();
  });
});

describe('Kelola Kunjungan: pencarian dan status disaring server sebelum paginasi', () => {
  const brs = (id: string, nama: string, status = 'selesai', layanan = 'Helpdesk OSS') => ({
    id, nama, asal: 'walk_in', status, waktu_masuk: '2026-10-13T02:00:00.000Z', tanggal: '2026-10-13', fo_nama: null,
    tiket_antrean: [{ nomor_display: 'A-001', waktu_selesai: null, layanan: { nama: layanan } }],
  });
  const panggilanDaftar = () => m.h.rpcLog.filter((l) => l.nama === 'fo_kunjungan_daftar');
  const terakhir = () => panggilanDaftar()[panggilanDaftar().length - 1].args;

  it('mengetik mengirim p_cari ke server setelah jeda (debounce), kembali ke halaman 1, dan menampilkan total terfilter', async () => {
    m.h.rpc = (nama, args) => {
      if (nama !== 'fo_kunjungan_daftar') return { data: null, error: null };
      return args.p_cari === 'dewi'
        ? { data: { rows: [brs('k-9', 'Dewi Lestari')], total: 1 }, error: null }
        : { data: { rows: [brs('k-1', 'Budi')], total: 60 }, error: null };
    };
    render(<KunjunganPage />);
    await screen.findByText('Budi');
    fireEvent.click(screen.getByRole('button', { name: /Halaman berikutnya/ }));
    await waitFor(() => expect(terakhir()).toMatchObject({ p_lewati: 25 }));

    const muatSebelum = panggilanDaftar().length;
    fireEvent.change(screen.getByLabelText('Cari nama atau layanan'), { target: { value: 'dewi' } });
    // Belum ada permintaan per ketukan: menunggu jeda.
    expect(panggilanDaftar()).toHaveLength(muatSebelum);
    expect(await screen.findByText('Dewi Lestari')).toBeInTheDocument();
    expect(terakhir()).toMatchObject({ p_cari: 'dewi', p_status: null, p_lewati: 0 });
    expect(screen.getByText(/total 1 data/)).toBeInTheDocument();
    expect(screen.getByText(/1 kunjungan sesuai filter/)).toBeInTheDocument();
  });

  it('beberapa ketukan beruntun hanya menghasilkan satu permintaan dengan teks akhir', async () => {
    m.h.rpc = () => ({ data: { rows: [brs('k-1', 'Budi')], total: 1 }, error: null });
    render(<KunjunganPage />);
    await screen.findByText('Budi');
    const awal = panggilanDaftar().length;
    const kotak = screen.getByLabelText('Cari nama atau layanan');
    fireEvent.change(kotak, { target: { value: 'b' } });
    fireEvent.change(kotak, { target: { value: 'bu' } });
    fireEvent.change(kotak, { target: { value: 'bud' } });
    await waitFor(() => expect(panggilanDaftar().length).toBe(awal + 1));
    await new Promise((r) => setTimeout(r, 450));
    expect(panggilanDaftar().length).toBe(awal + 1);
    expect(terakhir()).toMatchObject({ p_cari: 'bud' });
  });

  it('klik status mengirim p_status seketika dan kembali ke halaman 1', async () => {
    m.h.rpc = () => ({ data: { rows: [brs('k-1', 'Budi')], total: 60 }, error: null });
    render(<KunjunganPage />);
    await screen.findByText('Budi');
    fireEvent.click(screen.getByRole('button', { name: /Halaman berikutnya/ }));
    await waitFor(() => expect(terakhir()).toMatchObject({ p_lewati: 25 }));
    fireEvent.click(screen.getByRole('button', { name: /^Selesai$/ }));
    await waitFor(() => expect(terakhir()).toMatchObject({ p_status: 'selesai', p_cari: null, p_lewati: 0 }));
  });

  it('respons usang dibuang: jawaban lambat dari filter lama tidak menimpa hasil filter terbaru', async () => {
    let bukaLambat!: () => void;
    const lambat = new Promise<void>((r) => { bukaLambat = r; });
    m.h.rpc = (nama, args) => {
      if (nama !== 'fo_kunjungan_daftar') return { data: null, error: null };
      if (args.p_cari === 'lama') {
        return lambat.then(() => ({ data: { rows: [brs('k-1', 'Hasil Lama')], total: 1 }, error: null }));
      }
      if (args.p_cari === 'baru') return { data: { rows: [brs('k-2', 'Hasil Baru')], total: 1 }, error: null };
      return { data: { rows: [brs('k-0', 'Awal')], total: 1 }, error: null };
    };
    render(<KunjunganPage />);
    await screen.findByText('Awal');
    const kotak = screen.getByLabelText('Cari nama atau layanan');
    fireEvent.change(kotak, { target: { value: 'lama' } });
    await waitFor(() => expect(terakhir()).toMatchObject({ p_cari: 'lama' }));
    fireEvent.change(kotak, { target: { value: 'baru' } });
    expect(await screen.findByText('Hasil Baru')).toBeInTheDocument();
    await act(async () => { bukaLambat(); await lambat; });
    expect(screen.queryByText('Hasil Lama')).toBeNull();
    expect(screen.getByText('Hasil Baru')).toBeInTheDocument();
  });

  it('RPC lama tanpa p_cari/p_status: halaman menyaring baris yang tampil di klien dan tetap berjalan', async () => {
    m.h.rpc = (nama, args) => {
      if (nama !== 'fo_kunjungan_daftar') return { data: null, error: null };
      if ('p_cari' in args) return { data: null, error: { code: 'PGRST202', message: 'tidak ada' } };
      return { data: { rows: [brs('k-1', 'Budi'), brs('k-2', 'Dewi')], total: 2 }, error: null };
    };
    render(<KunjunganPage />);
    await screen.findByText('Dewi');
    fireEvent.change(screen.getByLabelText('Cari nama atau layanan'), { target: { value: 'dewi' } });
    await waitFor(() => expect(screen.queryByText('Budi')).toBeNull());
    expect(screen.getByText('Dewi')).toBeInTheDocument();
  });

  it('tidak ada hasil dari server -> keadaan kosong yang bermakna, bukan skeleton', async () => {
    m.h.rpc = (nama, args) => (nama === 'fo_kunjungan_daftar' && args.p_cari === 'zzz'
      ? { data: { rows: [], total: 0 }, error: null }
      : { data: { rows: [brs('k-1', 'Budi')], total: 1 }, error: null });
    render(<KunjunganPage />);
    await screen.findByText('Budi');
    fireEvent.change(screen.getByLabelText('Cari nama atau layanan'), { target: { value: 'zzz' } });
    expect(await screen.findByText('Tidak ada kunjungan yang cocok')).toBeInTheDocument();
  });
});

describe('Kelola Kunjungan: jendela tanggal Front Office non-Koordinator', () => {
  const rpcOk = (nama: string) => (nama === 'fo_kunjungan_daftar'
    ? { data: { rows: [kunjungan('k-1', 'Budi')], total: 1 }, error: null }
    : { data: null, error: null });
  const panggilanDaftar = () => m.h.rpcLog.filter((l) => l.nama === 'fo_kunjungan_daftar');
  it('FO biasa: kalender membatasi tanggal; hari di luar rentang tidak memanggil server', async () => {
    m.h.tabel.petugas = { data: [{ id: 'p-1', role: 'front_office', koordinator: false }], error: null };
    m.h.rpc = rpcOk;
    render(<KunjunganPage />);
    await screen.findByText('Budi');
    const awal = panggilanDaftar().length;
    fireEvent.click(screen.getByRole('button', { name: /^Tanggal kunjungan:/ }));
    const dialog = screen.getByRole('dialog', { name: 'Tanggal kunjungan' });
    const dilarang = dialog.querySelector<HTMLButtonElement>('button[data-tanggal][aria-disabled="true"]');
    expect(dilarang).not.toBeNull();
    fireEvent.click(dilarang!);
    expect(panggilanDaftar()).toHaveLength(awal);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    pilihTanggal(addDaysWIB(-3));
    await waitFor(() => expect(panggilanDaftar().length).toBe(awal + 1));
    expect(panggilanDaftar()[awal].args).toMatchObject({ p_tanggal: addDaysWIB(-3) });
  });

  it('Admin dan FO Koordinator: kalender tidak membatasi tanggal', async () => {
    for (const peran of [{ id: 'p-1', role: 'admin' }, { id: 'p-2', role: 'front_office', koordinator: true }]) {
      cleanup();
      m.h.tabel.petugas = { data: [peran], error: null };
      m.h.rpc = rpcOk;
      render(<KunjunganPage />);
      await screen.findByText('Budi');
      fireEvent.click(screen.getByRole('button', { name: /^Tanggal kunjungan:/ }));
      expect(screen.getByRole('dialog').querySelector('button[data-tanggal][aria-disabled="true"]')).toBeNull();
    }
  });

  it('galat TANGGAL_DILUAR_BATAS dari server tampil sebagai pesan jelas, bukan "periksa koneksi"', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    m.h.rpc = () => ({ data: null, error: { code: '22023', message: 'TANGGAL_DILUAR_BATAS: di luar jendela' } });
    render(<KunjunganPage />);
    expect(await screen.findByText(/7 hari ke belakang sampai besok/)).toBeInTheDocument();
    expect(screen.queryByText(/Periksa koneksi/)).toBeNull();
    spy.mockRestore();
  });
});

describe('Kunjungan: filter di URL', () => {
  const baris = { ...kunjungan('k-1', 'Budi'), fo_nama: null };
  const terakhir = () => m.h.rpcLog.filter((r) => r.nama === 'fo_kunjungan_daftar').at(-1)?.args;
  beforeEach(() => {
    m.h.rpc = () => ({ data: { rows: [baris], total: 90 }, error: null });
  });

  it('membaca tanggal, status, halaman dan membersihkan pencarian URL lama tanpa memakainya', async () => {
    m.query = `tanggal=${addDaysWIB(-2)}&status=selesai&cari=Budi&halaman=2`;
    render(<KunjunganPage />);
    await screen.findByText('Budi');
    expect(terakhir()).toMatchObject({ p_tanggal: addDaysWIB(-2), p_status: 'selesai', p_cari: null, p_lewati: 25 });
    expect(screen.getByLabelText('Cari nama atau layanan')).toHaveValue('');
    expect(screen.getByRole('button', { name: /^Selesai$/ })).toHaveAttribute('aria-pressed', 'true');
    expect(m.router.replace).toHaveBeenLastCalledWith(`/admin/kunjungan?tanggal=${addDaysWIB(-2)}&status=selesai&halaman=2`, { scroll: false });
    expect(m.query).not.toContain('cari=');
  });

  it('pencarian tetap lokal dan hanya halaman ditulis lewat replace tanpa menggulir', async () => {
    render(<KunjunganPage />);
    await screen.findByText('Budi');
    fireEvent.change(screen.getByLabelText('Cari nama atau layanan'), { target: { value: 'Budi' } });
    await waitFor(() => expect(terakhir()).toMatchObject({ p_cari: 'Budi' }));
    expect(m.router.replace).not.toHaveBeenCalled();
    expect(m.query).toBe('');
    fireEvent.click(screen.getByRole('button', { name: /Halaman berikutnya/ }));
    await waitFor(() => expect(m.router.replace).toHaveBeenLastCalledWith('/admin/kunjungan?halaman=2', { scroll: false }));
  });

  it('status yang diklik sebelum jeda pencarian selesai mempertahankan ketikan', async () => {
    render(<KunjunganPage />);
    await screen.findByText('Budi');
    fireEvent.change(screen.getByLabelText('Cari nama atau layanan'), { target: { value: 'Budi' } });
    fireEvent.click(screen.getByRole('button', { name: /^Selesai$/ }));
    await waitFor(() => expect(terakhir()).toMatchObject({ p_status: 'selesai', p_cari: 'Budi', p_lewati: 0 }));
    expect(m.router.replace).toHaveBeenLastCalledWith('/admin/kunjungan?status=selesai', { scroll: false });
    expect(screen.getByLabelText('Cari nama atau layanan')).toHaveValue('Budi');
  });

  it('perubahan URL dari luar mengikuti tanggal dan status tanpa menimpa pencarian lokal', async () => {
    const { rerender } = render(<KunjunganPage />);
    await screen.findByText('Budi');
    fireEvent.change(screen.getByLabelText('Cari nama atau layanan'), { target: { value: 'belum terkirim' } });
    m.query = `tanggal=${addDaysWIB(-1)}&status=menunggu&cari=Dewi`;
    rerender(<KunjunganPage />);
    await waitFor(() => expect(terakhir()).toMatchObject({ p_tanggal: addDaysWIB(-1), p_status: 'menunggu', p_cari: 'belum terkirim' }));
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    expect(screen.getByLabelText('Cari nama atau layanan')).toHaveValue('belum terkirim');
    expect(m.router.replace).toHaveBeenLastCalledWith(`/admin/kunjungan?tanggal=${addDaysWIB(-1)}&status=menunggu`, { scroll: false });
  });
  it.each(['status', 'halaman'] as const)('ketikan lanjutan bertahan saat replace %s baru selesai', async (filter) => {
    m.query = `tanggal=${addDaysWIB(-1)}`;
    m.router.replace.mockImplementation(() => undefined);
    const { rerender } = render(<KunjunganPage />);
    await screen.findByText('Budi');
    const input = screen.getByLabelText('Cari nama atau layanan');
    fireEvent.change(input, { target: { value: 'Budi' } });
    await waitFor(() => expect(terakhir()).toMatchObject({ p_cari: 'Budi' }));
    fireEvent.click(screen.getByRole('button', {
      name: filter === 'status' ? /^Selesai$/ : /Halaman berikutnya/,
    }));
    const urlTertunda = m.router.replace.mock.calls.at(-1)![0] as string;
    fireEvent.change(input, { target: { value: 'Budi Santoso' } });
    m.query = urlTertunda.split('?')[1] ?? '';
    rerender(<KunjunganPage />);
    expect(input).toHaveValue('Budi Santoso');
    await waitFor(() => expect(terakhir()).toMatchObject({
      p_tanggal: addDaysWIB(-1), p_status: filter === 'status' ? 'selesai' : null,
      p_cari: 'Budi Santoso', p_lewati: 0,
    }));
    expect(input).toHaveValue('Budi Santoso');
    for (const [url] of m.router.replace.mock.calls) expect(url).not.toContain('cari=');
    if (filter === 'halaman') {
      expect(m.router.replace).toHaveBeenLastCalledWith(`/admin/kunjungan?tanggal=${addDaysWIB(-1)}`, { scroll: false });
    }
  });

});
