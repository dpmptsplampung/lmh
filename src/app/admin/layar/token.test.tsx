// @vitest-environment jsdom
// Bagian token halaman Layar admin: token baru 8 angka (diketik dengan remote TV), token lama tetap bisa dipakai dan dicabut.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, act, within } from '@testing-library/react';
import { formatTanggal } from '@/lib/utils';
import { formatTokenTampilan, tokenBerupaAngka, tautanLayar } from './tokenTampilan';

const toastMock = vi.hoisted(() => vi.fn());
vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('@/components/layout/PageHeader', () => ({
  default: ({ title, children }: { title: string; children?: React.ReactNode }) => (
    <div><h1>{title}</h1>{children}</div>
  ),
}));

import { createClient } from '@/lib/supabase/client';
import AdminLayarPage from './page';

function thenable<T>(hasil: { data: T; error: null }) {
  const p = Promise.resolve(hasil);
  const o: Record<string, unknown> = {
    eq: () => o, in: () => o, limit: () => o, order: () => o, select: () => o,
    then: p.then.bind(p), catch: p.catch.bind(p),
  };
  return o;
}

const TOKENS = [
  { id: 't1', token: '48205917', nama: 'Layar Lobi', aktif: true, created_at: '2026-11-03T00:00:00Z' },
  { id: 't2', token: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', nama: 'Layar Lama', aktif: true, created_at: '2026-10-01T00:00:00Z' },
];

function pasang() {
  const from = vi.fn(() => ({ select: () => thenable({ data: [], error: null }) }));
  vi.mocked(createClient).mockReturnValue({ from } as unknown as ReturnType<typeof createClient>);
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    void url; void init;
    return { json: async () => ({ data: TOKENS }) } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  const tulis = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: tulis }, configurable: true });
  return { fetchMock, tulis };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('tokenTampilan', () => {
  it('8 angka dikelompokkan 4-4 hanya sebagai tampilan; token lama apa adanya', () => {
    expect(formatTokenTampilan('48205917')).toBe('4820 5917');
    expect(formatTokenTampilan('00004205')).toBe('0000 4205');
    expect(formatTokenTampilan('a1b2c3d4e5f60718293a4b5c6d7e8f90')).toBe('a1b2c3d4e5f60718293a4b5c6d7e8f90');
    expect(formatTokenTampilan('1234567')).toBe('1234567');
    expect(tokenBerupaAngka('48205917')).toBe(true);
    expect(tokenBerupaAngka('4820 5917')).toBe(false);
  });
  it('tautan memakai nilai token sebenarnya, tanpa spasi', () => {
    expect(tautanLayar('https://lmh.test', '48205917')).toBe('https://lmh.test/layar/48205917');
  });
});

describe('Admin Layar: token 8 angka', () => {
  it('Enter ganda ketika pembuatan masih berjalan hanya mengirim satu permintaan token', async () => {
    const m = pasang();
    let selesaikan!: (res: Response) => void;
    const tertunda = new Promise<Response>(resolve => { selesaikan = resolve; });
    m.fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? tertunda : { json: async () => ({ data: TOKENS }) } as Response,
    );
    render(<AdminLayarPage />);
    await screen.findByText('4820 5917');
    const input = screen.getByRole('textbox', { name: /nama layar/i });
    fireEvent.change(input, { target: { value: 'Layar Baru' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('button', { name: /buat token/i })).toBeDisabled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(m.fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    await act(async () => { selesaikan({ json: async () => ({ data: {} }) } as Response); });
    await waitFor(() => expect(input).toHaveValue(''));
    fireEvent.change(input, { target: { value: 'Layar Berikutnya' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(m.fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2));
  });

  it('menampilkan kode berkelompok "4820 5917"; token lama tetap tampil', async () => {
    pasang();
    render(<AdminLayarPage />);
    expect(await screen.findByText('4820 5917')).toBeInTheDocument();
    expect(screen.getByText('a1b2c3d4e5f60718293a4b5c6d7e8f90')).toBeInTheDocument();
  });

  it('Salin tautan menyalin /layar/<8 angka> lengkap tanpa spasi', async () => {
    const m = pasang();
    render(<AdminLayarPage />);
    await screen.findByText('4820 5917');
    fireEvent.click(screen.getByRole('button', { name: /salin tautan layar lobi/i }));
    await waitFor(() => expect(m.tulis).toHaveBeenCalledWith(`${window.location.origin}/layar/48205917`));
  });

  it('salin gagal (clipboard ditolak) memberi galat, bukan sukses palsu', async () => {
    const m = pasang();
    m.tulis.mockRejectedValueOnce(new Error('ditolak'));
    render(<AdminLayarPage />);
    await screen.findByText('4820 5917');
    fireEvent.click(screen.getByRole('button', { name: /salin tautan layar lobi/i }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringMatching(/tidak bisa menyalin/i), 'error'));
    expect(toastMock).not.toHaveBeenCalledWith(expect.stringMatching(/disalin/i), 'success');
  });

  it('token lama tetap bisa dicabut lewat API', async () => {
    const m = pasang();
    render(<AdminLayarPage />);
    await screen.findByText('4820 5917');
    fireEvent.click(screen.getByRole('button', { name: /cabut layar lama/i }));
    expect(m.fetchMock).not.toHaveBeenCalledWith('/api/admin/layar', expect.objectContaining({ body: JSON.stringify({ aksi: 'cabut', id: 't2' }) }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ya, cabut' }));
    await waitFor(() =>
      expect(m.fetchMock).toHaveBeenCalledWith('/api/admin/layar', expect.objectContaining({ body: JSON.stringify({ aksi: 'cabut', id: 't2' }) })),
    );
  });

  // Karakterisasi tabel token aktif (G3 3.6): jumlah baris/kolom dan teks sel harus sama sebelum dan sesudah pindah ke <Tabel>.
  it('tabel token aktif: empat kolom, satu baris per token, teks sel tetap', async () => {
    pasang();
    render(<AdminLayarPage />);
    await screen.findByText('4820 5917');
    const tabel = screen.getByRole('table', { name: 'Token akses layar TV aktif' });
    expect(within(tabel).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Nama Layar', 'Kode Layar', 'Dibuat', 'Aksi']);
    const baris = within(tabel).getAllByRole('row');
    expect(baris).toHaveLength(3); // kepala + dua token
    expect(baris[1].children).toHaveLength(4);
    expect(baris[2].children).toHaveLength(4);
    const teks = (b: HTMLElement, i: number) => b.children[i].textContent?.trim();
    expect(teks(baris[1], 0)).toBe('Layar Lobi');
    expect(teks(baris[1], 1)).toBe('4820 5917');
    expect(teks(baris[1], 2)).toBe(formatTanggal('2026-11-03T00:00:00Z'));
    expect(teks(baris[2], 0)).toBe('Layar Lama');
    expect(teks(baris[2], 1)).toBe('a1b2c3d4e5f60718293a4b5c6d7e8f90Kode lama, masih berlaku');
    expect(teks(baris[2], 2)).toBe(formatTanggal('2026-10-01T00:00:00Z'));
    expect(within(baris[1]).getByRole('button', { name: /salin tautan layar lobi/i })).toBeInTheDocument();
    expect(within(baris[1]).getByRole('link', { name: /buka/i })).toHaveAttribute('href', '/layar/48205917');
    expect(within(baris[1]).getByRole('button', { name: /cabut layar lobi/i })).toBeInTheDocument();
  });

  it('teks bantuan menyebut kode 8 angka untuk remote TV', async () => {
    pasang();
    render(<AdminLayarPage />);
    expect(await screen.findByText(/8 angka/i)).toBeInTheDocument();
  });
});
