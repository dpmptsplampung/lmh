// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('@/components/QRCode', () => ({
  default: ({ value }: { value: string }) => <div data-testid="qr">{value}</div>,
}));

import { createClient } from '@/lib/supabase/client';
import ReservasiPage from './page';

type RpcFn = (nama: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

describe('reservasi pengunjung (rpc reservasi_buat / reservasi_batalkan, daftar dari kunjungan)', () => {
  const consentInsert = vi.fn();
  const rpc = vi.fn<RpcFn>();
  const tabelDiakses: string[] = [];
  let kunjunganRows: Record<string, unknown>[] = [];
  let layananRows: { id: string; nama: string }[] = [];
  const kunjunganEq = vi.fn();

  // Format tanggal lokal (bukan toISOString yang bergeser karena timezone)
  const toLocalYmd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // Hari kerja terdekat (Senin–Jumat) yang lolos validasi klien
  const nextWeekday = () => {
    const d = new Date();
    for (let i = 0; i < 10; i++) {
      const day = d.getDay();
      if (day !== 0 && day !== 6) return toLocalYmd(d);
      d.setDate(d.getDate() + 1);
    }
    return '';
  };

  const berhasilBuat = { data: { ok: true, kunjungan_id: 'k-1', qr_token: 'a'.repeat(32), tanggal: '2099-01-01', status: 'terjadwal' }, error: null };

  beforeEach(() => {
    vi.clearAllMocks();
    tabelDiakses.length = 0;
    kunjunganRows = [];
    layananRows = [];
    consentInsert.mockResolvedValue({ error: null });
    rpc.mockImplementation(async (nama) => {
      if (nama === 'reservasi_buat') return berhasilBuat;
      if (nama === 'reservasi_batalkan') return { data: { ok: true, status: 'batal' }, error: null };
      if (nama === 'is_layanan_buka_jadwal') return { data: true, error: null };
      return { data: null, error: { message: 'tidak dikenal' } };
    });

    const builder = (table: string) => {
      tabelDiakses.push(table);
      if (table === 'pengunjung') {
        const b = { select: vi.fn(() => b), eq: vi.fn(() => b), single: vi.fn().mockResolvedValue({ data: { id: 'visitor-1', nama: 'Nama Kanonis' }, error: null }) };
        return b;
      }
      if (table === 'v_layanan_publik') {
        const b = { select: vi.fn(() => b), neq: vi.fn(() => b), order: vi.fn(async () => ({ data: layananRows, error: null })) };
        return b;
      }
      if (table === 'kunjungan') {
        const b = {
          select: vi.fn(() => b),
          eq: vi.fn((k: string, v: unknown) => {
            kunjunganEq(k, v);
            return b;
          }),
          order: vi.fn(() => b),
          limit: vi.fn(async () => ({ data: kunjunganRows, error: null })),
        };
        return b;
      }
      if (table === 'consent_log') return { insert: consentInsert };
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

  const fillValidForm = () => {
    fireEvent.click(screen.getByText('Bertemu Seseorang'));
    fireEvent.change(screen.getByLabelText('Nama yang Ingin Ditemui'), { target: { value: 'Kepala Bidang' } });
    fireEvent.change(screen.getByLabelText('Tanggal Kedatangan'), { target: { value: nextWeekday() } });
    fireEvent.click(screen.getByLabelText(/saya setuju data saya diproses/i));
  };
  const kirim = () => fireEvent.click(screen.getByRole('button', { name: 'Buat Reservasi' }));
  const panggilanRpc = (nama: string) => rpc.mock.calls.filter((c) => c[0] === nama);

  it('memanggil rpc reservasi_buat (bukan INSERT visit) dengan parameter kontrak §4.1 dan menampilkan QR dari qr_token', async () => {
    render(<ReservasiPage />);
    await screen.findByText('Rencanakan Kedatangan');
    fillValidForm();
    fireEvent.change(screen.getByLabelText(/Keperluan/), { target: { value: '  Konsultasi  ' } });
    fireEvent.change(screen.getByLabelText(/Perkiraan Jam/), { target: { value: '09:30' } });
    kirim();

    expect(await screen.findByText(/Reservasi Berhasil/)).toBeInTheDocument();
    const [nama, args] = panggilanRpc('reservasi_buat')[0];
    expect(nama).toBe('reservasi_buat');
    expect(args).toEqual({
      p_tujuan: 'bertemu_seseorang',
      p_tanggal: nextWeekday(),
      p_layanan_id: null,
      p_nama_yang_ditemui: 'Kepala Bidang',
      p_keperluan: 'Konsultasi',
      p_jam_rencana: '09:30',
    });
    expect(screen.getAllByTestId('qr').some((q) => q.textContent === 'a'.repeat(32))).toBe(true);
    expect(tabelDiakses).not.toContain('visit');
  });

  it('tujuan loket: layanan dikirim sebagai p_layanan_id, nama yang ditemui null', async () => {
    layananRows = [{ id: 'lay-1', nama: 'Helpdesk OSS' }];
    render(<ReservasiPage />);
    await screen.findByText('Rencanakan Kedatangan');
    fireEvent.click(screen.getByText('Menuju Loket Layanan'));
    fireEvent.change(await screen.findByLabelText('Layanan Tujuan'), { target: { value: 'lay-1' } });
    fireEvent.change(screen.getByLabelText('Tanggal Kedatangan'), { target: { value: nextWeekday() } });
    fireEvent.click(screen.getByLabelText(/saya setuju data saya diproses/i));
    kirim();

    expect(await screen.findByText(/Reservasi Berhasil/)).toBeInTheDocument();
    expect(panggilanRpc('reservasi_buat')[0][1]).toMatchObject({
      p_tujuan: 'loket',
      p_layanan_id: 'lay-1',
      p_nama_yang_ditemui: null,
      p_jam_rencana: null,
    });
  });

  it('mencatat consent_log SEBELUM memanggil rpc reservasi_buat', async () => {
    const urutan: string[] = [];
    consentInsert.mockImplementation(async () => {
      urutan.push('consent');
      return { error: null };
    });
    rpc.mockImplementation(async (nama) => {
      if (nama === 'reservasi_buat') urutan.push('rpc');
      return berhasilBuat;
    });
    render(<ReservasiPage />);
    await screen.findByText('Rencanakan Kedatangan');
    fillValidForm();
    kirim();

    await screen.findByText(/Reservasi Berhasil/);
    expect(urutan).toEqual(['consent', 'rpc']);
    expect(consentInsert.mock.calls[0][0]).toMatchObject({
      subjek_ref: 'auth-1',
      tujuan: 'reservasi_data',
      disetujui: true,
      versi_kebijakan: '1.0',
    });
  });

  it('menolak tanggal akhir pekan di klien tanpa memanggil rpc', async () => {
    render(<ReservasiPage />);
    await screen.findByText('Rencanakan Kedatangan');
    const d = new Date();
    while (d.getDay() !== 6) d.setDate(d.getDate() + 1);

    fireEvent.click(screen.getByText('Bertemu Seseorang'));
    fireEvent.change(screen.getByLabelText('Nama yang Ingin Ditemui'), { target: { value: 'Kepala Bidang' } });
    fireEvent.change(screen.getByLabelText('Tanggal Kedatangan'), { target: { value: toLocalYmd(d) } });
    fireEvent.click(screen.getByLabelText(/saya setuju data saya diproses/i));
    kirim();

    expect((await screen.findAllByText(/hari kerja \(Senin–Jumat\)/)).length).toBeGreaterThan(0);
    expect(panggilanRpc('reservasi_buat')).toHaveLength(0);
  });

  it('menolak tanggal lebih dari 7 hari ke depan (QUE-05) tanpa memanggil rpc', async () => {
    render(<ReservasiPage />);
    await screen.findByText('Rencanakan Kedatangan');
    const d = new Date();
    d.setDate(d.getDate() + 30);

    fireEvent.click(screen.getByText('Bertemu Seseorang'));
    fireEvent.change(screen.getByLabelText('Nama yang Ingin Ditemui'), { target: { value: 'Kepala Bidang' } });
    fireEvent.change(screen.getByLabelText('Tanggal Kedatangan'), { target: { value: toLocalYmd(d) } });
    fireEvent.click(screen.getByLabelText(/saya setuju data saya diproses/i));
    kirim();

    await screen.findByText(/maksimal 7 hari ke depan/i);
    expect(panggilanRpc('reservasi_buat')).toHaveLength(0);
  });

  describe('pemetaan galat reservasi_buat', () => {
    it.each([
      ['TANGGAL_TIDAK_VALID', /Tanggal tidak valid/],
      ['LAYANAN_TIDAK_BUKA', /tidak beroperasi pada tanggal itu/],
      ['LAYANAN_TIDAK_VALID', /Layanan yang dipilih tidak valid/],
      ['RESERVASI_GANDA', /sudah memiliki reservasi yang sama/],
      ['KUOTA_PENUH', /Kuota layanan pada tanggal itu sudah penuh/],
      ['DATA_TIDAK_VALID', /Data reservasi ditolak server/],
      ['FORBIDDEN', /belum memiliki profil pengunjung/],
    ])('%s -> pesan Indonesia, bukan sukses', async (kode, pola) => {
      rpc.mockImplementation(async (nama) =>
        nama === 'reservasi_buat'
          ? { data: null, error: { message: `${kode}: detail server`, code: 'P0001' } }
          : { data: null, error: null },
      );
      render(<ReservasiPage />);
      await screen.findByText('Rencanakan Kedatangan');
      fillValidForm();
      kirim();

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toMatch(pola);
      expect(screen.queryByText(/Reservasi Berhasil/)).toBeNull();
      expect(screen.getByRole('button', { name: 'Buat Reservasi' })).toBeEnabled();
    });

    it('galat tak dikenal memakai pesan umum; kegagalan jaringan memakai pesan koneksi', async () => {
      rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom', code: 'XX000' } });
      render(<ReservasiPage />);
      await screen.findByText('Rencanakan Kedatangan');
      fillValidForm();
      kirim();
      expect((await screen.findByRole('alert')).textContent).toContain('Gagal membuat reservasi');

      rpc.mockResolvedValueOnce({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' } });
      kirim();
      await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Koneksi bermasalah'));
    });
  });

  // Audit S1 / keputusan K11: consent_log memblokir pembuatan reservasi bila gagal dicatat.
  describe('consent PDP memblokir reservasi (S1)', () => {
    const GAGAL_RLS = { error: { message: 'new row violates row-level security policy', code: '42501' } };

    it('consent gagal ({ error }): rpc TIDAK dipanggil, pesan + Coba lagi tampil, bukan sukses', async () => {
      consentInsert.mockResolvedValue(GAGAL_RLS);
      render(<ReservasiPage />);
      await screen.findByText('Rencanakan Kedatangan');
      fillValidForm();
      kirim();

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain('Persetujuan belum tercatat, coba lagi');
      expect(within(alert).getByRole('button', { name: /coba lagi/i })).toBeInTheDocument();
      expect(panggilanRpc('reservasi_buat')).toHaveLength(0);
      expect(screen.queryByText(/Reservasi Berhasil/)).toBeNull();
      expect(screen.getByRole('button', { name: 'Buat Reservasi' })).toBeEnabled();
    });

    it('consent gagal karena insert menolak (jaringan putus): rpc TIDAK dipanggil', async () => {
      consentInsert.mockRejectedValue(new TypeError('Failed to fetch'));
      render(<ReservasiPage />);
      await screen.findByText('Rencanakan Kedatangan');
      fillValidForm();
      kirim();

      expect((await screen.findByRole('alert')).textContent).toContain('Persetujuan belum tercatat, coba lagi');
      expect(panggilanRpc('reservasi_buat')).toHaveLength(0);
    });

    it('"Coba lagi" mengulang consent; bila berhasil rpc dipanggil dan reservasi dibuat', async () => {
      consentInsert.mockResolvedValueOnce(GAGAL_RLS).mockResolvedValueOnce({ error: null });
      render(<ReservasiPage />);
      await screen.findByText('Rencanakan Kedatangan');
      fillValidForm();
      kirim();

      const alert = await screen.findByRole('alert');
      expect(panggilanRpc('reservasi_buat')).toHaveLength(0);
      fireEvent.click(within(alert).getByRole('button', { name: /coba lagi/i }));

      await waitFor(() => expect(panggilanRpc('reservasi_buat')).toHaveLength(1));
      expect(consentInsert).toHaveBeenCalledTimes(2);
      expect(await screen.findByText(/Reservasi Berhasil/)).toBeInTheDocument();
    });
  });

  describe('Reservasi Saya (kunjungan, §6.6) dan pembatalan', () => {
    const baris = (o: Record<string, unknown> = {}) => ({
      id: 'k-9',
      tanggal: '2099-03-02',
      status: 'terjadwal',
      qr_token: 'b'.repeat(32),
      tujuan: 'loket',
      layanan_saran_id: 'lay-1',
      jam_rencana: '10:15:00',
      nama_yang_ditemui: null,
      ...o,
    });

    it('membaca dari kunjungan (asal=reservasi, milik pengunjung ini), QR untuk yang terjadwal, nama layanan dari id saran', async () => {
      layananRows = [{ id: 'lay-1', nama: 'Helpdesk OSS' }];
      kunjunganRows = [baris(), baris({ id: 'k-8', status: 'selesai', qr_token: 'c'.repeat(32) })];
      render(<ReservasiPage />);
      const judul = await screen.findByRole('heading', { name: 'Reservasi Saya' });
      const bagian = judul.closest('section') as HTMLElement;

      await waitFor(() => expect(within(bagian).getAllByText('Helpdesk OSS')).toHaveLength(2));
      expect(tabelDiakses).toContain('kunjungan');
      expect(tabelDiakses).not.toContain('visit');
      expect(kunjunganEq).toHaveBeenCalledWith('asal', 'reservasi');
      expect(kunjunganEq).toHaveBeenCalledWith('pengunjung_id', 'visitor-1');
      // QR hanya untuk reservasi terjadwal
      expect(within(bagian).getAllByTestId('qr').map((q) => q.textContent)).toEqual(['b'.repeat(32)]);
      expect(within(bagian).getByText('Selesai')).toBeInTheDocument();
      expect(within(bagian).getAllByText('10:15 WIB').length).toBeGreaterThan(0);
    });

    it('Batalkan -> konfirmasi -> rpc reservasi_batalkan(p_kunjungan_id) lalu daftar disegarkan', async () => {
      kunjunganRows = [baris()];
      render(<ReservasiPage />);
      fireEvent.click(await screen.findByRole('button', { name: /batalkan reservasi/i }));
      expect(panggilanRpc('reservasi_batalkan')).toHaveLength(0); // butuh konfirmasi

      kunjunganRows = [baris({ status: 'batal' })];
      fireEvent.click(screen.getByRole('button', { name: /ya, batalkan/i }));

      expect(await screen.findByText('Reservasi dibatalkan.')).toBeInTheDocument();
      expect(panggilanRpc('reservasi_batalkan')[0][1]).toEqual({ p_kunjungan_id: 'k-9' });
      await waitFor(() => expect(screen.getByText('Dibatalkan')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: /batalkan reservasi/i })).toBeNull();
    });

    it('pembatalan ditolak server (INVALID_STATUS): pesan galat, bukan "dibatalkan"', async () => {
      kunjunganRows = [baris()];
      rpc.mockImplementation(async (nama) =>
        nama === 'reservasi_batalkan'
          ? { data: null, error: { message: 'INVALID_STATUS: sudah check-in', code: 'P0001' } }
          : berhasilBuat,
      );
      render(<ReservasiPage />);
      fireEvent.click(await screen.findByRole('button', { name: /batalkan reservasi/i }));
      fireEvent.click(screen.getByRole('button', { name: /ya, batalkan/i }));

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toMatch(/sudah tidak dapat dibatalkan/);
      expect(screen.queryByText('Reservasi dibatalkan.')).toBeNull();
    });
  });
});
