// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { pushMock, enqueueMock, syncMock, rpcMock, createClientMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  enqueueMock: vi.fn(),
  syncMock: vi.fn(),
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, replace: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: createClientMock }));
vi.mock('@/lib/offline/queue', () => ({ enqueueAction: enqueueMock }));
vi.mock('@/lib/offline/sync', () => ({ daftarkanSyncOffline: syncMock }));

import FoDaftarPage from './page';

const sukses = {
  data: { ok: true, sudah_ada: false, kunjungan_id: 'k-1', penanganan_id: 'p-1', qr_token: 'qr', mulai_at: '2026-10-13T01:00:00Z' },
  error: null,
};
const galat = (kode: string, code = 'P0001') => ({ data: null, error: { message: `${kode}: detail`, code } });

function setOnline(nilai: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value: nilai, configurable: true });
}

async function renderHalaman() {
  render(<FoDaftarPage />);
  await screen.findByLabelText(/Nama Lengkap/);
  // tunggu daftar layanan dimuat
  await screen.findByRole('option', { name: 'Helpdesk OSS' });
}

const isi = (label: RegExp | string, nilai: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: nilai } });
const kirim = () => fireEvent.click(screen.getByRole('button', { name: /Daftarkan & Mulai Layani/ }));
const isiMinimal = () => {
  isi(/Nama Lengkap/, 'Budi Santoso');
  isi(/Asal \/ Instansi/, 'PT Maju');
};

describe('/admin/fo/daftar (pendaftaran walk-in oleh FO)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setOnline(true);
    rpcMock.mockResolvedValue(sukses);
    enqueueMock.mockResolvedValue('q-1');
    syncMock.mockResolvedValue(true);
    const layanan = {
      select: vi.fn(() => layanan),
      eq: vi.fn(() => layanan),
      order: vi.fn(async () => ({ data: [{ id: 'lay-1', nama: 'Helpdesk OSS' }], error: null })),
    };
    createClientMock.mockReturnValue({
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'fo-user-1' } } } }) },
      from: vi.fn(() => layanan),
      rpc: rpcMock,
    });
  });

  afterEach(() => {
    cleanup();
    setOnline(true);
  });

  it('semua kolom berlabel (htmlFor) dan tombol utama ada', async () => {
    await renderHalaman();
    for (const label of [/Nama Lengkap/, /Asal \/ Instansi/, /Nomor Handphone/, /Kategori Pengunjung/, /^Email/, /Layanan Saran/, /^Keperluan/]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: /Daftarkan & Mulai Layani/ })).toBeEnabled();
  });

  it('validasi: kolom wajib kosong -> galat per kolom (aria-invalid), fokus ke yang pertama, rpc tidak dipanggil', async () => {
    await renderHalaman();
    kirim();

    expect(await screen.findByRole('alert')).toHaveTextContent(/Periksa kembali isian/);
    expect(screen.getByLabelText(/Nama Lengkap/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/Nama Lengkap/)).toHaveAttribute('aria-describedby', 'fo-nama-galat');
    expect(screen.getByLabelText(/Asal \/ Instansi/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/Nama Lengkap/)).toHaveFocus();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('validasi: HP dan email salah ditolak di klien', async () => {
    await renderHalaman();
    isiMinimal();
    isi(/Nomor Handphone/, '12345');
    isi(/^Email/, 'bukan-email');
    kirim();

    expect(await screen.findByText(/Nomor handphone tidak valid/)).toBeInTheDocument();
    expect(screen.getByText(/Format email tidak valid/)).toBeInTheDocument();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('sukses: memanggil rpc fo_mulai_kunjungan dengan parameter kontrak lalu menuju /admin/fo/penanganan', async () => {
    await renderHalaman();
    isiMinimal();
    isi(/Nomor Handphone/, '0812 3456-7890');
    isi(/Kategori Pengunjung/, 'UMKM');
    isi(/^Email/, 'budi@contoh.id');
    isi(/Layanan Saran/, 'lay-1');
    isi(/^Keperluan/, '  Urus NIB  ');
    kirim();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/admin/fo/penanganan'));
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [nama, args] = rpcMock.mock.calls[0];
    expect(nama).toBe('fo_mulai_kunjungan');
    expect(args).toMatchObject({
      p_nama: 'Budi Santoso',
      p_asal_instansi: 'PT Maju',
      p_kontak_hp: '081234567890',
      p_kategori: 'UMKM',
      p_email: 'budi@contoh.id',
      p_keperluan: 'Urus NIB',
      p_layanan_saran_id: 'lay-1',
    });
    expect(args.p_client_request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('tombol dikunci selama request dan klik ganda hanya mengirim sekali', async () => {
    let selesai!: (v: unknown) => void;
    rpcMock.mockReturnValue(new Promise((r) => { selesai = r; }));
    await renderHalaman();
    isiMinimal();
    const tombol = screen.getByRole('button', { name: /Daftarkan & Mulai Layani/ });
    fireEvent.click(tombol);
    fireEvent.click(tombol);

    await waitFor(() => expect(screen.getByRole('button', { name: /Menyimpan/ })).toBeDisabled());
    expect(rpcMock).toHaveBeenCalledTimes(1);

    selesai(sukses);
    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
  });

  describe('idempotensi client_request_id', () => {
    it('retry dengan data SAMA memakai id yang sama; data diubah -> id baru; sukses -> id baru untuk kunjungan berikutnya', async () => {
      rpcMock.mockResolvedValueOnce(galat('ANEH', 'XX000')).mockResolvedValueOnce(galat('ANEH', 'XX000'));
      await renderHalaman();
      isiMinimal();
      kirim();
      await screen.findByText(/Gagal menyimpan kunjungan/);
      kirim();
      await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(2));
      await screen.findByText(/Gagal menyimpan kunjungan/);
      const id1 = rpcMock.mock.calls[0][1].p_client_request_id;
      expect(rpcMock.mock.calls[1][1].p_client_request_id).toBe(id1);

      isi(/Asal \/ Instansi/, 'PT Berubah');
      kirim();
      await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
      const id3 = rpcMock.mock.calls[2][1].p_client_request_id;
      expect(id3).not.toBe(id1);

      // Kunjungan berikutnya (form direset setelah sukses) = id lagi berbeda
      isiMinimal();
      kirim();
      await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(4));
      expect(rpcMock.mock.calls[3][1].p_client_request_id).not.toBe(id3);
    });

    it("'sudah_ada: true' dari server dianggap sukses", async () => {
      rpcMock.mockResolvedValue({ data: { ...sukses.data, sudah_ada: true }, error: null });
      await renderHalaman();
      isiMinimal();
      kirim();
      await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/admin/fo/penanganan'));
    });
  });

  describe('pemetaan galat (tidak pernah sukses palsu)', () => {
    it.each([
      ['LAYANAN_TUTUP', /sudah tutup/],
      ['DATA_TIDAK_VALID', /Data ditolak server/],
      ['LAYANAN_TIDAK_VALID', /Layanan saran tidak valid/],
      ['IDEMPOTENSI_BENTROK', /bentrok/],
      ['FORBIDDEN', /tidak berwenang/],
    ])('%s', async (kode, pola) => {
      rpcMock.mockResolvedValue(galat(kode));
      await renderHalaman();
      isiMinimal();
      kirim();

      expect(await screen.findByRole('alert')).toHaveTextContent(pola);
      expect(pushMock).not.toHaveBeenCalled();
      expect(enqueueMock).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /Daftarkan & Mulai Layani/ })).toBeEnabled();
      // Isian dipertahankan agar FO tidak mengetik ulang
      expect(screen.getByLabelText(/Nama Lengkap/)).toHaveValue('Budi Santoso');
    });

    it('SESI_TIDAK_SAH menampilkan tautan masuk kembali', async () => {
      rpcMock.mockResolvedValue(galat('SESI_TIDAK_SAH', '42501'));
      await renderHalaman();
      isiMinimal();
      kirim();
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/Sesi Anda sudah berakhir/);
      expect(screen.getByRole('link', { name: /Masuk kembali/ })).toHaveAttribute('href', expect.stringContaining('/login'));
    });
  });

  describe('offline (antrean khusus FO, idempoten)', () => {
    it('saat offline: disimpan ke antrean dengan owner = FO yang masuk, rpc tidak dipanggil, FO diberi tahu', async () => {
      setOnline(false);
      await renderHalaman();
      isiMinimal();
      kirim();

      expect(await screen.findByText(/disimpan di perangkat ini/)).toBeInTheDocument();
      expect(rpcMock).not.toHaveBeenCalled();
      expect(enqueueMock).toHaveBeenCalledTimes(1);
      const aksi = enqueueMock.mock.calls[0][0];
      expect(aksi.type).toBe('fo_walkin');
      expect(aksi.owner_user_id).toBe('fo-user-1');
      expect(aksi.payload).toMatchObject({ p_nama: 'Budi Santoso', p_asal_instansi: 'PT Maju' });
      expect(aksi.payload.p_client_request_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(syncMock).toHaveBeenCalled();
      expect(pushMock).not.toHaveBeenCalled();
      expect(screen.getByLabelText(/Nama Lengkap/)).toHaveValue(''); // siap pengunjung berikutnya
    });

    it('koneksi putus saat mengirim: antrean memakai client_request_id YANG SAMA dengan percobaan online', async () => {
      rpcMock.mockResolvedValue({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' } });
      await renderHalaman();
      isiMinimal();
      kirim();

      expect(await screen.findByText(/disimpan di perangkat ini/)).toBeInTheDocument();
      expect(enqueueMock.mock.calls[0][0].payload.p_client_request_id).toBe(rpcMock.mock.calls[0][1].p_client_request_id);
    });

    it('antrean gagal disimpan (mis. IndexedDB tidak tersedia): pesan koneksi, tidak diam-diam hilang', async () => {
      setOnline(false);
      enqueueMock.mockRejectedValue(new Error('IndexedDB unavailable'));
      await renderHalaman();
      isiMinimal();
      kirim();
      expect(await screen.findByRole('alert')).toHaveTextContent(/Koneksi bermasalah/);
      expect(screen.queryByText(/disimpan di perangkat ini/)).toBeNull();
      expect(screen.getByLabelText(/Nama Lengkap/)).toHaveValue('Budi Santoso');
    });
  });
});
