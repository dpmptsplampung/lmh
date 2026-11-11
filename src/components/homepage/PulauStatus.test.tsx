// @vitest-environment jsdom
// Pulau klien daftar layanan: daftar kartu datang dari server (ada pada render pertama), sedangkan status buka
// hari ini (RPC layanan_status_hari_ini), tombol Coba lagi, dan popup /?layanan=<slug> dimuat/diatur di klien.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { HasilLayanan, LayananEtalase, StatusHariIni } from '@/lib/homepage/data';

const h = vi.hoisted(() => ({
  push: vi.fn(),
  back: vi.fn(),
  replace: vi.fn(),
  params: new URLSearchParams(),
  status: vi.fn(),
  layanan: vi.fn(),
  antrean: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: h.push, back: h.back, replace: h.replace }),
  useSearchParams: () => h.params,
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('@/lib/homepage/data', async (impor) => {
  const asli = await impor<typeof import('@/lib/homepage/data')>();
  return {
    ...asli,
    muatStatusHariIni: (...a: unknown[]) => h.status(...a),
    muatLayananKetat: (...a: unknown[]) => h.layanan(...a),
    muatAntrean: (...a: unknown[]) => h.antrean(...a),
  };
});

import PulauStatus from './PulauStatus';

const layanan = (id: string, nama: string, o: Partial<LayananEtalase> = {}): LayananEtalase => ({
  id,
  nama,
  slug: nama.toLowerCase().replace(/\s+/g, '-'),
  deskripsi: `Deskripsi ${nama}`,
  urutan: 1,
  instansi: 'DPMPTSP',
  instansiSingkatan: null,
  websiteTerkait: [],
  statusTampilan: 'aktif',
  punyaAntrean: true,
  punyaChat: true,
  tampilDiHomepage: true,
  ...o,
});
const dua = [layanan('1', 'Helpdesk OSS'), layanan('2', 'Bank Lampung')];
const teks = { title: '{jumlah} Layanan dalam Satu Atap', label: '', description: '' };
const hasil = (daftar: LayananEtalase[], tingkat: HasilLayanan['tingkat'] = 1): HasilLayanan => ({ layanan: daftar, tingkat });

beforeEach(() => {
  h.push.mockClear();
  h.back.mockClear();
  h.replace.mockClear();
  h.params = new URLSearchParams();
  h.status.mockReset();
  h.status.mockResolvedValue(null);
  h.layanan.mockReset();
  h.layanan.mockResolvedValue(hasil(dua));
  h.antrean.mockReset();
  h.antrean.mockResolvedValue(null);
});
afterEach(cleanup);

describe('PulauStatus: daftar dari server', () => {
  it('kartu dan judul langsung ada pada render pertama (tanpa menunggu status/klien)', () => {
    h.status.mockReturnValue(new Promise(() => {})); // status belum kembali
    render(<PulauStatus layanan={dua} layananGalat={false} teksDaftar={teks} />);
    expect(screen.getByRole('heading', { level: 2, name: '2 Layanan dalam Satu Atap' })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.queryByText('Buka sekarang')).toBeNull();
    expect(h.layanan).not.toHaveBeenCalled(); // daftar TIDAK dimuat ulang dari peramban
  });

  it('layanan tampil_di_homepage=false tidak dapat kartu dan tidak dihitung', () => {
    render(
      <PulauStatus
        layanan={[...dua, layanan('3', 'Tersembunyi', { tampilDiHomepage: false })]}
        layananGalat={false}
        teksDaftar={teks}
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: '2 Layanan dalam Satu Atap' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Tersembunyi/ })).toBeNull();
  });

  it('daftar kosong yang sah: keterangan "sedang disiapkan", tanpa galat', () => {
    render(<PulauStatus layanan={[]} layananGalat={false} teksDaftar={teks} />);
    expect(screen.getByText(/sedang disiapkan/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('daftar mengikuti props baru dari server (mis. setelah router.refresh)', () => {
    const { rerender } = render(<PulauStatus layanan={dua} layananGalat={false} teksDaftar={teks} />);
    expect(screen.getAllByRole('article')).toHaveLength(2);
    rerender(<PulauStatus layanan={[dua[0]]} layananGalat={false} teksDaftar={teks} />);
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });
});

describe('PulauStatus: status buka hari ini (dimuat klien)', () => {
  it('status muncul di kartu setelah RPC kembali', async () => {
    h.status.mockResolvedValue(
      new Map<string, StatusHariIni>([
        ['1', { buka: true, liburKeterangan: null, jadwal: [] }],
        ['2', { buka: false, liburKeterangan: null, jadwal: [{ hari: 4, jamMulai: '08:00', jamSelesai: '15:30' }] }],
      ]),
    );
    render(<PulauStatus layanan={dua} layananGalat={false} teksDaftar={teks} />);
    expect(await screen.findByText('Buka sekarang')).toBeInTheDocument();
    expect(screen.getByText('Tutup saat ini · Buka setiap Kamis')).toBeInTheDocument();
    expect(h.status).toHaveBeenCalledTimes(1);
  });

  it('status menggantung: setelah 6 detik kartu tetap tampil apa adanya (tanpa lencana, tanpa galat)', async () => {
    vi.useFakeTimers();
    try {
      h.status.mockReturnValue(new Promise(() => {}));
      render(<PulauStatus layanan={dua} layananGalat={false} teksDaftar={teks} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6100);
      });
      expect(screen.getAllByRole('article')).toHaveLength(2);
      expect(screen.queryByText('Buka sekarang')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('RPC gagal (null): kartu tanpa lencana status', async () => {
    h.status.mockResolvedValue(null);
    render(<PulauStatus layanan={dua} layananGalat={false} teksDaftar={teks} />);
    await waitFor(() => expect(h.status).toHaveBeenCalled());
    expect(screen.queryByText('Buka sekarang')).toBeNull();
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });
});

describe('PulauStatus: Coba lagi (A-01)', () => {
  it('galat dari server: tampil galat + Coba lagi, bukan "sedang disiapkan"', () => {
    render(<PulauStatus layanan={[]} layananGalat teksDaftar={teks} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/belum dapat dimuat/i);
    expect(screen.queryByText(/sedang disiapkan/i)).toBeNull();
  });

  it('Coba lagi memuat ulang HANYA daftar layanan lewat peramban lalu menampilkan kartu', async () => {
    render(<PulauStatus layanan={[]} layananGalat teksDaftar={teks} />);
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(await screen.findByRole('button', { name: /Helpdesk OSS/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(h.layanan).toHaveBeenCalledTimes(1);
    expect(h.status).toHaveBeenCalledTimes(1); // status tidak ikut dimuat ulang
  });

  it('Coba lagi yang gagal lagi tetap menampilkan galat', async () => {
    h.layanan.mockResolvedValue(hasil([], 0));
    render(<PulauStatus layanan={[]} layananGalat teksDaftar={teks} />);
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    await waitFor(() => expect(h.layanan).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('alert')).toHaveTextContent(/belum dapat dimuat/i);
  });
});

describe('PulauStatus: popup dan alamatnya', () => {
  it('klik kartu mendorong /?layanan=<slug> tanpa gulir', () => {
    render(<PulauStatus layanan={dua} layananGalat={false} teksDaftar={teks} />);
    fireEvent.click(screen.getByRole('button', { name: /Bank Lampung/ }));
    expect(h.push).toHaveBeenCalledWith('/?layanan=bank-lampung', { scroll: false });
  });

  it('deep link ?layanan=<slug> membuka dialog layanan itu', async () => {
    h.params = new URLSearchParams('layanan=helpdesk-oss');
    render(<PulauStatus layanan={dua} layananGalat={false} teksDaftar={teks} />);
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByRole('heading', { level: 2, name: 'Helpdesk OSS' })).toBeInTheDocument();
  });

  it('layanan tanpa kartu tetap terbuka lewat alamat (tautan bot tidak mati)', async () => {
    h.params = new URLSearchParams('layanan=tersembunyi');
    render(
      <PulauStatus
        layanan={[...dua, layanan('3', 'Tersembunyi', { tampilDiHomepage: false })]}
        layananGalat={false}
        teksDaftar={teks}
      />,
    );
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('tanpa teksDaftar (blok layanan dimatikan admin): tidak ada bagian layanan, popup lewat alamat tetap hidup', async () => {
    h.params = new URLSearchParams('layanan=helpdesk-oss');
    render(<PulauStatus layanan={dua} layananGalat={false} />);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(document.querySelector('section#layanan')).toBeNull();
  });

  it('menutup popup yang dibuka dari kartu = kembali (history.back); dari deep link = replace ke /', async () => {
    const { rerender } = render(<PulauStatus layanan={dua} layananGalat={false} teksDaftar={teks} />);
    fireEvent.click(screen.getByRole('button', { name: /Helpdesk OSS/ }));
    h.params = new URLSearchParams('layanan=helpdesk-oss');
    rerender(<PulauStatus layanan={dua} layananGalat={false} teksDaftar={teks} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Tutup' }));
    expect(h.back).toHaveBeenCalledTimes(1);
    expect(h.replace).not.toHaveBeenCalled();

    cleanup();
    h.back.mockClear();
    h.params = new URLSearchParams('layanan=helpdesk-oss');
    render(<PulauStatus layanan={dua} layananGalat={false} teksDaftar={teks} />);
    const dlg = await screen.findByRole('dialog');
    await act(async () => {});
    fireEvent.keyDown(dlg, { key: 'Escape' });
    expect(h.replace).toHaveBeenCalledWith('/', { scroll: false });
    expect(h.back).not.toHaveBeenCalled();
  });

  it('popup memuat status dan antrean yang sama dengan kartu', async () => {
    h.status.mockResolvedValue(
      new Map<string, StatusHariIni>([['1', { buka: true, liburKeterangan: null, jadwal: [{ hari: 1, jamMulai: '08:00', jamSelesai: '15:30' }] }]]),
    );
    h.antrean.mockResolvedValue(new Map([['1', { antre: 4, dilayani: 1, estimasiTungguMenit: 30 }]]));
    h.params = new URLSearchParams('layanan=helpdesk-oss');
    render(<PulauStatus layanan={dua} layananGalat={false} teksDaftar={teks} />);
    const dlg = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dlg).getByText('Buka sekarang')).toBeInTheDocument());
    await waitFor(() => expect(within(dlg).getByText(/4 menunggu/)).toBeInTheDocument());
  });
});
