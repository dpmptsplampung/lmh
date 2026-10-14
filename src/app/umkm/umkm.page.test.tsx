// @vitest-environment jsdom
// Audit T6 (K10: perbaikan minimal): halaman UMKM publik tidak boleh menampilkan
// "Belum ada listing" saat pemuatan gagal, dan tidak boleh melaporkan "link edit
// terkirim" bila permintaannya gagal.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

import { createClient } from '@/lib/supabase/client';
import UMKMPage from './page';

type Hasil = { data: unknown[] | null; error: { message: string; code?: string } | null };

const BARIS_LISTING = {
  id: '11111111-1111-4111-8111-111111111111',
  nama_umkm: 'Kopi Way Kanan',
  kategori_kebutuhan: 'bahan_baku',
  deskripsi: 'Butuh pemasok biji kopi',
  foto_produk: null,
  status: 'published',
  sisi: 'kebutuhan',
  created_at: '2026-10-01T00:00:00Z',
};

const BARIS_MATCH = {
  kebutuhan_id: 'k1',
  kebutuhan_nama: 'Warung Sumber Rejeki',
  kategori: 'bahan_baku',
  kebutuhan_deskripsi: null,
  penawaran_id: 'p1',
  penawaran_nama: 'Koperasi Tani Makmur',
  penawaran_deskripsi: null,
};

const GAGAL: Hasil = { data: null, error: { message: 'boom', code: '500' } };
const ok = (data: unknown[]): Hasil => ({ data, error: null });

describe('UMKM publik: pemuatan listing/match (T6)', () => {
  // Hasil per pemanggilan; pemanggilan berikutnya mengambil antrean berikutnya,
  // lalu mengulang elemen terakhir.
  let antreanListing: Array<() => Promise<Hasil>>;
  let antreanMatch: Array<() => Promise<Hasil>>;
  const panggilanListing = vi.fn();
  const panggilanMatch = vi.fn();

  const ambil = (antrean: Array<() => Promise<Hasil>>, n: number) =>
    antrean[Math.min(n, antrean.length - 1)]();

  beforeEach(() => {
    vi.clearAllMocks();
    antreanListing = [() => Promise.resolve(ok([]))];
    antreanMatch = [() => Promise.resolve(ok([]))];

    (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      from: vi.fn((tabel: string) => ({
        select: () => ({
          order: () => {
            if (tabel === 'v_umkm_public') {
              panggilanListing();
              return ambil(antreanListing, panggilanListing.mock.calls.length - 1);
            }
            if (tabel === 'v_umkm_match') {
              panggilanMatch();
              return ambil(antreanMatch, panggilanMatch.mock.calls.length - 1);
            }
            throw new Error(`tabel tak terduga: ${tabel}`);
          },
        }),
      })),
    });
  });

  afterEach(cleanup);

  it('listing sukses dengan baris: menampilkan kartu, tanpa alert', async () => {
    antreanListing = [() => Promise.resolve(ok([BARIS_LISTING]))];
    render(<UMKMPage />);

    expect(await screen.findByText('Kopi Way Kanan')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('listing sukses tetapi kosong: tetap "Belum ada listing", BUKAN error', async () => {
    antreanListing = [() => Promise.resolve(ok([]))];
    render(<UMKMPage />);

    expect(await screen.findByText('Belum ada listing UMKM tersedia')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('listing gagal ({ error }): tampil ErrorRetry, BUKAN "Belum ada listing"', async () => {
    antreanListing = [() => Promise.resolve(GAGAL)];
    render(<UMKMPage />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Daftar UMKM belum dapat dimuat/);
    expect(within(alert).getByRole('button', { name: /coba lagi/i })).toBeInTheDocument();
    expect(screen.queryByText(/Belum ada listing/i)).toBeNull();
    expect(screen.queryByText('Belum Ada Listing')).toBeNull();
  });

  it('listing gagal karena fetch menolak (jaringan): tampil ErrorRetry juga', async () => {
    antreanListing = [() => Promise.reject(new TypeError('Failed to fetch'))];
    render(<UMKMPage />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Daftar UMKM belum dapat dimuat/);
    expect(screen.queryByText(/Belum ada listing/i)).toBeNull();
  });

  it('"Coba lagi" memuat ulang listing dan menampilkan hasilnya', async () => {
    antreanListing = [
      () => Promise.resolve(GAGAL),
      () => Promise.resolve(ok([BARIS_LISTING])),
    ];
    render(<UMKMPage />);

    const tombol = within(await screen.findByRole('alert')).getByRole('button', {
      name: /coba lagi/i,
    });
    fireEvent.click(tombol);

    expect(await screen.findByText('Kopi Way Kanan')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(panggilanListing).toHaveBeenCalledTimes(2);
  });

  it('"Coba lagi" yang gagal lagi tetap menampilkan error (bukan keadaan kosong)', async () => {
    antreanListing = [() => Promise.resolve(GAGAL), () => Promise.resolve(GAGAL)];
    render(<UMKMPage />);

    fireEvent.click(
      within(await screen.findByRole('alert')).getByRole('button', { name: /coba lagi/i }),
    );

    await waitFor(() => expect(panggilanListing).toHaveBeenCalledTimes(2));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Daftar UMKM belum dapat dimuat/);
    expect(screen.queryByText(/Belum ada listing/i)).toBeNull();
  });

  describe('tab Cocok (Match)', () => {
    const bukaTabMatch = () =>
      fireEvent.click(screen.getByRole('button', { name: /cocok \(match\)/i }));

    it('match sukses dengan baris: menampilkan pasangan', async () => {
      antreanMatch = [() => Promise.resolve(ok([BARIS_MATCH]))];
      render(<UMKMPage />);
      await screen.findByText('Belum ada listing UMKM tersedia');

      bukaTabMatch();
      expect(await screen.findByText('Warung Sumber Rejeki')).toBeInTheDocument();
      expect(screen.getByText('Koperasi Tani Makmur')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('match sukses tetapi kosong: tetap "Belum Ada Pasangan Match"', async () => {
      antreanMatch = [() => Promise.resolve(ok([]))];
      render(<UMKMPage />);
      await screen.findByText('Belum ada listing UMKM tersedia');

      bukaTabMatch();
      expect(await screen.findByText('Belum Ada Pasangan Match')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('match gagal: tampil ErrorRetry, BUKAN "Belum Ada Pasangan Match"; Coba lagi memuat ulang', async () => {
      antreanMatch = [
        () => Promise.resolve(GAGAL),
        () => Promise.resolve(ok([BARIS_MATCH])),
      ];
      render(<UMKMPage />);
      await screen.findByText('Belum ada listing UMKM tersedia');

      bukaTabMatch();
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toMatch(/Pencocokan UMKM belum dapat dimuat/);
      expect(screen.queryByText('Belum Ada Pasangan Match')).toBeNull();

      fireEvent.click(within(alert).getByRole('button', { name: /coba lagi/i }));

      expect(await screen.findByText('Warung Sumber Rejeki')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(panggilanMatch).toHaveBeenCalledTimes(2);
    });

    it('match gagal karena penolakan jaringan: tampil ErrorRetry', async () => {
      antreanMatch = [() => Promise.reject(new TypeError('Failed to fetch'))];
      render(<UMKMPage />);
      await screen.findByText('Belum ada listing UMKM tersedia');

      bukaTabMatch();
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toMatch(/Pencocokan UMKM belum dapat dimuat/);
      expect(screen.queryByText('Belum Ada Pasangan Match')).toBeNull();
    });
  });
});

describe('UMKM publik: permintaan link edit (T6)', () => {
  const fetchMock = vi.fn();

  const jawab = (status: number, body?: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  const bukaModalEdit = async () => {
    render(<UMKMPage />);
    fireEvent.click(await screen.findByRole('button', { name: /minta link edit untuk kopi way kanan/i }));
    const email = screen.getByPlaceholderText('email@pemilik-umkm.id');
    fireEvent.change(email, { target: { value: 'pemilik@contoh.id' } });
    return email;
  };

  const kirim = () => fireEvent.click(screen.getByRole('button', { name: 'Kirim Link Edit' }));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);

    (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      from: vi.fn(() => ({
        select: () => ({ order: () => Promise.resolve(ok([BARIS_LISTING])) }),
      })),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('res.ok: menampilkan "Permintaan Diterima" dan memanggil endpoint dengan listing + email', async () => {
    fetchMock.mockResolvedValue(jawab(200, { sent: true }));
    await bukaModalEdit();
    kirim();

    expect(await screen.findByText('Permintaan Diterima')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/umkm/request-edit-link');
    expect(JSON.parse(init.body)).toEqual({
      listing_id: BARIS_LISTING.id,
      email: 'pemilik@contoh.id',
    });
  });

  it('429 rate-limit: menampilkan pesan dari server, BUKAN "Permintaan Diterima"', async () => {
    fetchMock.mockResolvedValue(
      jawab(429, { error: 'Terlalu banyak permintaan. Coba lagi dalam beberapa menit.' }),
    );
    await bukaModalEdit();
    kirim();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Terlalu banyak permintaan/);
    expect(screen.queryByText('Permintaan Diterima')).toBeNull();
  });

  it('429 tanpa body JSON (mis. proxy): tetap pesan jelas, BUKAN sukses', async () => {
    fetchMock.mockResolvedValue(new Response('<html>429</html>', { status: 429 }));
    await bukaModalEdit();
    kirim();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Terlalu banyak permintaan/);
    expect(screen.queryByText('Permintaan Diterima')).toBeNull();
  });

  it('503: pesan generik berbahasa Indonesia (tanpa membocorkan pesan teknis Inggris), BUKAN sukses', async () => {
    fetchMock.mockResolvedValue(
      jawab(503, { error: 'Service unavailable — email delivery not configured' }),
    );
    await bukaModalEdit();
    kirim();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/belum dapat dikirim/i);
    expect(alert.textContent).not.toMatch(/Service unavailable/);
    expect(screen.queryByText('Permintaan Diterima')).toBeNull();
  });

  it('400 (email tidak valid): pesan jelas, BUKAN sukses', async () => {
    fetchMock.mockResolvedValue(jawab(400, { error: 'Invalid input' }));
    await bukaModalEdit();
    kirim();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/email/i);
    expect(alert.textContent).not.toMatch(/Invalid input/);
    expect(screen.queryByText('Permintaan Diterima')).toBeNull();
  });

  it('fetch melempar (jaringan putus): pesan koneksi, BUKAN sukses', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await bukaModalEdit();
    kirim();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/koneksi/i);
    expect(screen.queryByText('Permintaan Diterima')).toBeNull();
  });

  it('setelah gagal tombol dapat dicoba lagi (email dipertahankan) dan berhasil pada percobaan berikutnya', async () => {
    fetchMock
      .mockResolvedValueOnce(jawab(503, { error: 'Service unavailable' }))
      .mockResolvedValueOnce(jawab(200, { sent: true }));
    const email = await bukaModalEdit();
    kirim();

    await screen.findByRole('alert');
    expect((email as HTMLInputElement).value).toBe('pemilik@contoh.id');

    const ulang = screen.getByRole('button', { name: /coba lagi/i });
    expect(ulang).toBeEnabled();
    fireEvent.click(ulang);

    expect(await screen.findByText('Permintaan Diterima')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('pesan gagal dibersihkan saat modal ditutup lalu dibuka lagi', async () => {
    fetchMock.mockResolvedValue(jawab(503, {}));
    await bukaModalEdit();
    kirim();
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: 'Tutup' }));
    fireEvent.click(await screen.findByRole('button', { name: /minta link edit untuk kopi way kanan/i }));

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
