// @vitest-environment jsdom
// Bagian token halaman Layar admin: token baru 8 angka (diketik dengan remote TV), token lama tetap bisa dipakai dan dicabut.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';
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
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AdminLayarPage />);
    await screen.findByText('4820 5917');
    fireEvent.click(screen.getByRole('button', { name: /cabut layar lama/i }));
    await waitFor(() =>
      expect(m.fetchMock).toHaveBeenCalledWith('/api/admin/layar', expect.objectContaining({ body: JSON.stringify({ aksi: 'cabut', id: 't2' }) })),
    );
  });

  it('teks bantuan menyebut kode 8 angka untuk remote TV', async () => {
    pasang();
    render(<AdminLayarPage />);
    expect(await screen.findByText(/8 angka/i)).toBeInTheDocument();
  });
});
