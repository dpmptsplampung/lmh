// @vitest-environment jsdom
// Karakterisasi tambahan halaman reservasi (refaktor G9, tugas 9.0): perilaku yang belum dicakup reservasi.test.tsx
// (pesan validasi isian wajib, tombol tanpa persetujuan, sesi pengunjung hilang, penyegaran daftar saat RESERVASI_GANDA,
// galat daftar + Coba lagi, "Buat Reservasi Lain", daftar layanan, judul baris daftar). Ditulis terhadap page.tsx LAMA
// (HEAD) lalu dipertahankan tanpa perubahan terhadap hasil pemecahan.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('@/components/QRCode', () => ({
  default: ({ value }: { value: string }) => <div data-testid="qr">{value}</div>,
}));

import { createClient } from '@/lib/supabase/client';
import ReservasiPage from './page';
import { todayWIB } from '@/lib/time';

type RpcFn = (nama: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

const NAMA_BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

function pilihTanggal(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  fireEvent.click(screen.getByRole('button', { name: /^Tanggal Kedatangan:/ }));
  const cari = () => screen.queryByRole('button', { name: new RegExp(`^${d} ${NAMA_BULAN[m - 1]} ${y}(,|$)`) });
  for (let i = 0; i < 3 && !cari(); i++) fireEvent.click(screen.getByRole('button', { name: 'Bulan berikutnya' }));
  fireEvent.click(cari() as HTMLElement);
}

const toLocalYmd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hariKerjaTerdekat = () => {
  const d = new Date(`${todayWIB()}T12:00:00`);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return toLocalYmd(d);
};

describe('karakterisasi tambahan reservasi', () => {
  const rpc = vi.fn<RpcFn>();
  const kunjunganDibaca = vi.fn();
  let layananRows: Record<string, unknown>[] = [];
  let kunjunganRows: Record<string, unknown>[] = [];
  let kunjunganError: { message: string } | null = null;
  let pengunjung: { id: string; nama: string } | null = { id: 'visitor-1', nama: 'Nama' };

  beforeEach(() => {
    vi.clearAllMocks();
    layananRows = [];
    kunjunganRows = [];
    kunjunganError = null;
    pengunjung = { id: 'visitor-1', nama: 'Nama' };
    rpc.mockImplementation(async (nama) =>
      nama === 'reservasi_buat'
        ? { data: { ok: true, kunjungan_id: 'k-1', qr_token: 'z'.repeat(32), tanggal: '2099-01-01', status: 'terjadwal' }, error: null }
        : { data: true, error: null },
    );
    const builder = (table: string) => {
      if (table === 'pengunjung') {
        const b = { select: vi.fn(() => b), eq: vi.fn(() => b), single: vi.fn(async () => ({ data: pengunjung, error: null })) };
        return b;
      }
      if (table === 'v_layanan_publik') {
        const b = { select: vi.fn(() => b), neq: vi.fn(() => b), order: vi.fn(async () => ({ data: layananRows, error: null })) };
        return b;
      }
      if (table === 'kunjungan') {
        const b = {
          select: vi.fn(() => b),
          eq: vi.fn(() => b),
          order: vi.fn(() => b),
          limit: vi.fn(async () => {
            kunjunganDibaca();
            return kunjunganError ? { data: null, error: kunjunganError } : { data: kunjunganRows, error: null };
          }),
        };
        return b;
      }
      if (table === 'hari_libur') {
        const b = { select: vi.fn(() => b), eq: vi.fn(() => b), maybeSingle: vi.fn(async () => ({ data: null, error: null })) };
        return b;
      }
      if (table === 'consent_log') return { insert: vi.fn().mockResolvedValue({ error: null }) };
      if (table === 'v_antrian_loket') {
        const b = { select: vi.fn(() => b), eq: vi.fn(() => b), maybeSingle: vi.fn(async () => ({ data: null, error: null })) };
        return b;
      }
      return {};
    };
    (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'auth-1' } } }) },
      from: vi.fn(builder),
      rpc,
    });
  });

  afterEach(cleanup);

  const mulai = async () => {
    render(<ReservasiPage />);
    await screen.findByText('Rencanakan Kedatangan');
  };
  const setuju = () => fireEvent.click(screen.getByLabelText(/saya setuju data saya diproses/i));
  const kirim = () => fireEvent.click(screen.getByRole('button', { name: 'Buat Reservasi' }));

  describe('isian wajib (pesan menurut urutan pemeriksaan)', () => {
    it('tanpa tujuan: "Pilih tujuan kunjungan"', async () => {
      await mulai();
      setuju();
      kirim();
      expect(await screen.findByText('Pilih tujuan kunjungan')).toBeInTheDocument();
      expect(rpc).not.toHaveBeenCalled();
    });

    it('loket tanpa layanan: "Pilih layanan tujuan"', async () => {
      layananRows = [{ id: 'lay-1', nama: 'Helpdesk OSS' }];
      await mulai();
      fireEvent.click(screen.getByText('Menuju Loket Layanan'));
      await screen.findByLabelText(/^Layanan Tujuan/);
      setuju();
      kirim();
      expect(await screen.findByText('Pilih layanan tujuan')).toBeInTheDocument();
    });

    it('bertemu tanpa nama (spasi saja): "Masukkan nama orang yang ingin ditemui"', async () => {
      await mulai();
      fireEvent.click(screen.getByText('Bertemu Seseorang'));
      fireEvent.change(screen.getByLabelText(/^Nama yang Ingin Ditemui/), { target: { value: '   ' } });
      setuju();
      kirim();
      expect(await screen.findByText('Masukkan nama orang yang ingin ditemui')).toBeInTheDocument();
    });

    it('tanpa persetujuan: tombol Buat Reservasi nonaktif dan tidak ada panggilan RPC', async () => {
      await mulai();
      fireEvent.click(screen.getByText('Bertemu Seseorang'));
      expect(screen.getByRole('button', { name: 'Buat Reservasi' })).toBeDisabled();
      setuju();
      expect(screen.getByRole('button', { name: 'Buat Reservasi' })).toBeEnabled();
      setuju();
      expect(screen.getByRole('button', { name: 'Buat Reservasi' })).toBeDisabled();
      expect(rpc).not.toHaveBeenCalled();
    });

    it('loket dengan daftar layanan kosong: tombol Buat Reservasi nonaktif', async () => {
      await mulai();
      fireEvent.click(screen.getByText('Menuju Loket Layanan'));
      setuju();
      expect(screen.getByRole('button', { name: 'Buat Reservasi' })).toBeDisabled();
    });

    it('profil pengunjung tidak ada: "Sesi login tidak ditemukan. Silakan login ulang."', async () => {
      pengunjung = null;
      await mulai();
      fireEvent.click(screen.getByText('Bertemu Seseorang'));
      fireEvent.change(screen.getByLabelText(/^Nama yang Ingin Ditemui/), { target: { value: 'Kepala Bidang' } });
      pilihTanggal(hariKerjaTerdekat());
      setuju();
      kirim();
      expect(await screen.findByText('Sesi login tidak ditemukan. Silakan login ulang.')).toBeInTheDocument();
      expect(rpc.mock.calls.filter((c) => c[0] === 'reservasi_buat')).toHaveLength(0);
    });
  });

  describe('daftar layanan', () => {
    it('layanan tanpa antrean disembunyikan; coming_soon tampil nonaktif berlabel "(Segera hadir)"', async () => {
      layananRows = [
        { id: 'a', nama: 'Layanan A', status_tampilan: 'aktif', punya_antrean: true },
        { id: 'b', nama: 'Layanan B', status_tampilan: 'aktif', punya_antrean: false },
        { id: 'c', nama: 'Layanan C', status_tampilan: 'coming_soon', punya_antrean: true },
      ];
      await mulai();
      fireEvent.click(screen.getByText('Menuju Loket Layanan'));
      const pilihan = await screen.findByLabelText(/^Layanan Tujuan/);
      expect(within(pilihan).queryByText('Layanan B')).toBeNull();
      expect(within(pilihan).getByRole('option', { name: 'Layanan A' })).toBeEnabled();
      expect(within(pilihan).getByRole('option', { name: 'Layanan C (Segera hadir)' })).toBeDisabled();
    });

    it('memilih tujuan loket lalu bertemu mengosongkan layanan yang dipilih (dan sebaliknya nama)', async () => {
      layananRows = [{ id: 'lay-1', nama: 'Helpdesk OSS' }];
      await mulai();
      fireEvent.click(screen.getByText('Menuju Loket Layanan'));
      fireEvent.change(await screen.findByLabelText(/^Layanan Tujuan/), { target: { value: 'lay-1' } });
      fireEvent.click(screen.getByText('Bertemu Seseorang'));
      fireEvent.change(screen.getByLabelText(/^Nama yang Ingin Ditemui/), { target: { value: 'Kepala Bidang' } });
      fireEvent.click(screen.getByText('Menuju Loket Layanan'));
      expect((screen.getByLabelText(/^Layanan Tujuan/) as HTMLSelectElement).value).toBe('');
      fireEvent.click(screen.getByText('Bertemu Seseorang'));
      expect((screen.getByLabelText(/^Nama yang Ingin Ditemui/) as HTMLInputElement).value).toBe('');
    });
  });

  describe('sesudah kirim', () => {
    const kirimBertemu = async () => {
      await mulai();
      fireEvent.click(screen.getByText('Bertemu Seseorang'));
      fireEvent.change(screen.getByLabelText(/^Nama yang Ingin Ditemui/), { target: { value: 'Kepala Bidang' } });
      pilihTanggal(hariKerjaTerdekat());
      setuju();
      kirim();
    };

    it('berhasil: daftar disegarkan; "Buat Reservasi Lain" mengembalikan formulir kosong', async () => {
      await kirimBertemu();
      expect(await screen.findByText(/Reservasi Berhasil/)).toBeInTheDocument();
      await waitFor(() => expect(kunjunganDibaca).toHaveBeenCalledTimes(2)); // muat awal + sesudah kirim

      fireEvent.click(screen.getByRole('button', { name: 'Buat Reservasi Lain' }));
      expect(screen.getByText('Data kunjungan')).toBeInTheDocument();
      expect(screen.queryByLabelText(/^Nama yang Ingin Ditemui/)).toBeNull(); // tujuan kosong lagi
      expect(screen.getByRole('button', { name: /^Tanggal Kedatangan: belum dipilih/ })).toBeInTheDocument();
    });

    it('RESERVASI_GANDA: pesan galat dan daftar disegarkan (percobaan sebelumnya mungkin sudah tersimpan)', async () => {
      rpc.mockResolvedValue({ data: null, error: { message: 'RESERVASI_GANDA: ada', code: 'P0001' } });
      await kirimBertemu();
      expect((await screen.findByRole('alert')).textContent).toMatch(/sudah memiliki reservasi yang sama/);
      await waitFor(() => expect(kunjunganDibaca).toHaveBeenCalledTimes(2));
    });

    it('galat lain TIDAK menyegarkan daftar', async () => {
      rpc.mockResolvedValue({ data: null, error: { message: 'KUOTA_PENUH: penuh', code: 'P0001' } });
      await kirimBertemu();
      await screen.findByRole('alert');
      expect(kunjunganDibaca).toHaveBeenCalledTimes(1);
    });
  });

  describe('Reservasi Saya', () => {
    it('kosong: pesan "Belum ada reservasi."', async () => {
      await mulai();
      expect(screen.getByText('Belum ada reservasi.')).toBeInTheDocument();
    });

    it('galat memuat daftar: ErrorRetry; Coba lagi memuat ulang dan daftar tampil', async () => {
      kunjunganError = { message: 'putus' };
      await mulai();
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Daftar reservasi belum termuat');
      expect(screen.queryByText('Belum ada reservasi.')).toBeNull();

      kunjunganError = null;
      kunjunganRows = [{ id: 'k-1', tanggal: '2099-03-02', status: 'selesai', qr_token: 'q', tujuan: 'bertemu_seseorang', layanan_saran_id: null, jam_rencana: null, nama_yang_ditemui: 'Kepala Bidang' }];
      fireEvent.click(within(alert).getByRole('button', { name: 'Coba lagi' }));
      expect(await screen.findByText('Bertemu: Kepala Bidang')).toBeInTheDocument();
      expect(screen.queryByText('Daftar reservasi belum termuat')).toBeNull();
    });

    it('baris bertemu tanpa nama: "Bertemu: -"; status tak dikenal tampil apa adanya; tanpa QR bila bukan terjadwal', async () => {
      kunjunganRows = [{ id: 'k-1', tanggal: '2099-03-02', status: 'aneh', qr_token: 'q', tujuan: 'bertemu_seseorang', layanan_saran_id: null, jam_rencana: null, nama_yang_ditemui: null }];
      await mulai();
      expect(await screen.findByText('Bertemu: -')).toBeInTheDocument();
      expect(screen.getByText('aneh')).toBeInTheDocument();
      expect(screen.queryByTestId('qr')).toBeNull();
    });

    it('"Tidak" menutup konfirmasi tanpa memanggil RPC batal', async () => {
      kunjunganRows = [{ id: 'k-9', tanggal: '2099-03-02', status: 'terjadwal', qr_token: 'b'.repeat(32), tujuan: 'loket', layanan_saran_id: null, jam_rencana: null, nama_yang_ditemui: null }];
      await mulai();
      fireEvent.click(await screen.findByRole('button', { name: /batalkan reservasi/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Tidak' }));
      expect(screen.getByRole('button', { name: /batalkan reservasi/i })).toBeInTheDocument();
      expect(rpc.mock.calls.filter((c) => c[0] === 'reservasi_batalkan')).toHaveLength(0);
    });
  });
});
