// @vitest-environment jsdom
// Halaman Layar admin: token layar (tetap), urutan + "Nama di layar TV" per layanan, dan tiga pengumuman teks berjalan.
// Penulisan lewat klien sesi Admin (RLS layanan_admin_all / settings_admin_all); kolom/tabel migrasi layar TV
// (202611030012) bisa belum diterapkan -> pesan jelas, bukan crash.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';

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

type Err = { message: string; code?: string } | null;
interface Layanan { id: string; nama: string; nama_layar: string | null; urutan_layar: number | null }

const L = (id: string, nama: string, urutan: number | null = null, nama_layar: string | null = null): Layanan =>
  ({ id, nama, nama_layar, urutan_layar: urutan });

function thenable<T>(hasil: { data: T; error: Err }) {
  const p = Promise.resolve(hasil);
  const o: Record<string, unknown> = {
    eq: () => o, in: () => o, limit: () => o, order: () => o, select: () => o,
    then: p.then.bind(p), catch: p.catch.bind(p),
  };
  return o;
}

function pasang(opts: {
  layanan?: Layanan[];
  kolomBaruAda?: boolean;
  panggilanAda?: boolean;
  settings?: Record<string, string>;
  updateKosong?: boolean;
  tokens?: unknown[];
  settingsGalat?: boolean;
} = {}) {
  const kontrol = { settingsGalat: opts.settingsGalat === true };
  const { layanan = [], kolomBaruAda = true, panggilanAda = true, settings = {}, updateKosong = false } = opts;
  const updates: Array<{ id: string; nilai: Record<string, unknown> }> = [];
  const upserts: Array<Array<{ key: string; value: string }>> = [];
  const selects: string[] = [];

  const from = vi.fn((tabel: string) => {
    if (tabel === 'layanan') {
      return {
        select: (kolom: string) => {
          selects.push(kolom);
          if (!kolomBaruAda && kolom.includes('nama_layar')) {
            return thenable({ data: null, error: { message: 'column does not exist', code: '42703' } });
          }
          return thenable({ data: layanan, error: null });
        },
        update: (nilai: Record<string, unknown>) => ({
          eq: (_k: string, id: string) => ({
            select: () => {
              updates.push({ id, nilai });
              return Promise.resolve({ data: updateKosong ? [] : [{ id }], error: null });
            },
          }),
        }),
      };
    }
    if (tabel === 'site_settings') {
      return {
        select: () => thenable(kontrol.settingsGalat
          ? { data: null, error: { message: 'gangguan sementara' } }
          : { data: Object.entries(settings).map(([key, value]) => ({ key, value })), error: null }),
        upsert: (baris: Array<{ key: string; value: string }>) => {
          upserts.push(baris);
          return Promise.resolve({ error: null });
        },
      };
    }
    if (tabel === 'panggilan_layar') {
      return {
        select: () => thenable(panggilanAda
          ? { data: [], error: null }
          : { data: null, error: { message: 'relation does not exist', code: '42P01' } }),
      };
    }
    throw new Error(`tabel tak terduga: ${tabel}`);
  });
  vi.mocked(createClient).mockReturnValue({ from } as unknown as ReturnType<typeof createClient>);

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    void url; void init;
    return { json: async () => ({ data: opts.tokens ?? [] }) } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return { updates, upserts, selects, from, fetchMock, kontrol };
}

const namaDalamDaftar = () =>
  within(screen.getByRole('list', { name: /layanan di layar/i }))
    .getAllByRole('listitem')
    .map((li) => (within(li).getByLabelText(/nama di layar tv/i) as HTMLInputElement).placeholder);

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Admin Layar: layanan di layar TV', () => {
  it('menampilkan layanan menurut urutan_layar (null di akhir menurut nama) dengan nama tampil yang tersimpan', async () => {
    pasang({ layanan: [L('c', 'Zeta'), L('b', 'Beta', 2, 'Bet'), L('a', 'Alfa'), L('d', 'Gama', 1)] });
    render(<AdminLayarPage />);
    await screen.findByRole('list', { name: /layanan di layar/i });
    expect(namaDalamDaftar()).toEqual(['Gama', 'Beta', 'Alfa', 'Zeta']);
    expect(screen.getByDisplayValue('Bet')).toBeInTheDocument();
  });

  it('naik/turun mengubah urutan; baris pertama tak bisa naik dan terakhir tak bisa turun', async () => {
    pasang({ layanan: [L('a', 'Alfa', 1), L('b', 'Beta', 2)] });
    render(<AdminLayarPage />);
    await screen.findByRole('list', { name: /layanan di layar/i });
    expect(screen.getByRole('button', { name: /naikkan alfa/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /turunkan beta/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /turunkan alfa/i }));
    expect(namaDalamDaftar()).toEqual(['Beta', 'Alfa']);
    fireEvent.click(screen.getByRole('button', { name: /naikkan alfa/i }));
    expect(namaDalamDaftar()).toEqual(['Alfa', 'Beta']);
  });

  it('Simpan menulis urutan 1..n dan nama tampil (null bila kosong) hanya untuk baris yang berubah', async () => {
    const mock = pasang({ layanan: [L('a', 'Alfa', 1), L('b', 'Beta', 2), L('c', 'Gama', 3)] });
    render(<AdminLayarPage />);
    await screen.findByRole('list', { name: /layanan di layar/i });
    expect(screen.getByRole('button', { name: /simpan tampilan/i })).toBeDisabled(); // belum ada perubahan
    fireEvent.click(screen.getByRole('button', { name: /turunkan alfa/i }));
    const inputGama = within(screen.getAllByRole('listitem')[2]).getByLabelText(/nama di layar tv/i);
    fireEvent.change(inputGama, { target: { value: '  Gama TV  ' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan tampilan/i }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringMatching(/tersimpan/i), 'success'));
    const diurut = [...mock.updates].sort((x, y) => x.id.localeCompare(y.id));
    expect(diurut).toEqual([
      { id: 'a', nilai: { urutan_layar: 2, nama_layar: null } },
      { id: 'b', nilai: { urutan_layar: 1, nama_layar: null } },
      { id: 'c', nilai: { urutan_layar: 3, nama_layar: 'Gama TV' } },
    ]);
  });

  it('layanan yang tak berubah tidak ditulis', async () => {
    const mock = pasang({ layanan: [L('a', 'Alfa', 1), L('b', 'Beta', 2)] });
    render(<AdminLayarPage />);
    await screen.findByRole('list', { name: /layanan di layar/i });
    fireEvent.change(within(screen.getAllByRole('listitem')[1]).getByLabelText(/nama di layar tv/i), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan tampilan/i }));
    await waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]).toEqual({ id: 'b', nilai: { urutan_layar: 2, nama_layar: 'B' } });
  });

  it('isian nama tampil dibatasi 40 karakter', async () => {
    pasang({ layanan: [L('a', 'Alfa', 1)] });
    render(<AdminLayarPage />);
    await screen.findByRole('list', { name: /layanan di layar/i });
    expect(screen.getByLabelText(/nama di layar tv/i)).toHaveAttribute('maxlength', '40');
  });

  it('penulisan ditolak (0 baris) -> toast galat, bukan sukses', async () => {
    pasang({ layanan: [L('a', 'Alfa', 1), L('b', 'Beta', 2)], updateKosong: true });
    render(<AdminLayarPage />);
    await screen.findByRole('list', { name: /layanan di layar/i });
    fireEvent.click(screen.getByRole('button', { name: /turunkan alfa/i }));
    fireEvent.click(screen.getByRole('button', { name: /simpan tampilan/i }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.any(String), 'error'));
    expect(toastMock).not.toHaveBeenCalledWith(expect.stringMatching(/tersimpan/i), 'success');
  });

  it('tidak ada layanan -> keadaan kosong', async () => {
    pasang({ layanan: [] });
    render(<AdminLayarPage />);
    expect(await screen.findByText(/belum ada layanan yang tampil di layar/i)).toBeInTheDocument();
  });
});

describe('Admin Layar: migrasi layar TV belum diterapkan', () => {
  it('kolom nama_layar/urutan_layar belum ada -> daftar tetap tampil, ada peringatan, urutan dan simpan terkunci', async () => {
    pasang({ layanan: [L('a', 'Alfa'), L('b', 'Beta')], kolomBaruAda: false });
    render(<AdminLayarPage />);
    await screen.findByRole('list', { name: /layanan di layar/i });
    const peringatan = await screen.findByRole('alert');
    expect(peringatan).toHaveTextContent(/migrasi layar tv/i);
    expect(peringatan).toHaveTextContent(/belum diterapkan/i);
    expect(screen.getByRole('button', { name: /turunkan alfa/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /simpan tampilan/i })).toBeDisabled();
    expect(namaDalamDaftar()).toEqual(['Alfa', 'Beta']);
  });

  it('tabel panggilan_layar belum ada -> peringatan menyebut pita dan bunyi panggilan', async () => {
    pasang({ layanan: [L('a', 'Alfa', 1)], panggilanAda: false });
    render(<AdminLayarPage />);
    const peringatan = await screen.findByRole('alert');
    expect(peringatan).toHaveTextContent(/panggilan/i);
    expect(peringatan).toHaveTextContent(/belum diterapkan/i);
    // kolom ada: urutan tetap bisa diatur
    expect(screen.getByRole('button', { name: /turunkan alfa/i })).toBeDisabled(); // satu-satunya baris
  });

  it('semuanya ada -> tidak ada peringatan', async () => {
    pasang({ layanan: [L('a', 'Alfa', 1)] });
    render(<AdminLayarPage />);
    await screen.findByRole('list', { name: /layanan di layar/i });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('Admin Layar: pengumuman teks berjalan', () => {
  it('memuat tiga isian dari site_settings (pengumuman 1 = running_text_layar lama)', async () => {
    pasang({ settings: { running_text_layar: 'Satu', running_text_layar_3: 'Tiga' } });
    render(<AdminLayarPage />);
    await waitFor(() => expect(screen.getByLabelText(/pengumuman 1/i)).toHaveValue('Satu'));
    expect(screen.getByLabelText(/pengumuman 2/i)).toHaveValue('');
    expect(screen.getByLabelText(/pengumuman 3/i)).toHaveValue('Tiga');
    expect(screen.getByLabelText(/pengumuman 1/i)).toHaveAttribute('maxlength', '200');
  });

  it('Simpan pengumuman meng-upsert tiga kunci yang dirapikan; kosong disimpan sebagai string kosong', async () => {
    const mock = pasang({ settings: { running_text_layar: 'Lama' } });
    render(<AdminLayarPage />);
    await waitFor(() => expect(screen.getByLabelText(/pengumuman 1/i)).toHaveValue('Lama'));
    fireEvent.change(screen.getByLabelText(/pengumuman 2/i), { target: { value: '  Baru dua  ' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan pengumuman/i }));
    await waitFor(() => expect(mock.upserts).toHaveLength(1));
    expect(mock.upserts[0].map(({ key, value }) => ({ key, value }))).toEqual([
      { key: 'running_text_layar', value: 'Lama' },
      { key: 'running_text_layar_2', value: 'Baru dua' },
      { key: 'running_text_layar_3', value: '' },
    ]);
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringMatching(/pengumuman.*tersimpan/i), 'success'));
  });

  // UI-03: nilai awal kosong tidak boleh tersimpan sebagai pengumuman bila bacaan gagal / belum selesai.
  it('selama memuat, isian dan tombol Simpan terkunci', async () => {
    pasang({ settings: { running_text_layar: 'Satu' } });
    render(<AdminLayarPage />);
    expect(screen.getByRole('button', { name: /simpan pengumuman/i })).toBeDisabled();
    expect(screen.getByLabelText(/pengumuman 1/i)).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button', { name: /simpan pengumuman/i })).toBeEnabled());
    expect(screen.getByLabelText(/pengumuman 1/i)).toBeEnabled();
  });

  it('bacaan gagal: pesan galat + Coba lagi, Simpan terkunci sehingga tidak mengosongkan pengumuman tersimpan', async () => {
    const mock = pasang({ settingsGalat: true, settings: { running_text_layar: 'Satu', running_text_layar_2: 'Dua' } });
    render(<AdminLayarPage />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/pengumuman tidak dapat dimuat/i);
    const simpan = screen.getByRole('button', { name: /simpan pengumuman/i });
    expect(simpan).toBeDisabled();
    expect(screen.getByLabelText(/pengumuman 1/i)).toBeDisabled();
    fireEvent.click(simpan);
    expect(mock.upserts).toHaveLength(0);

    mock.kontrol.settingsGalat = false;
    fireEvent.click(within(alert).getByRole('button', { name: /coba lagi/i }));
    await waitFor(() => expect(screen.getByLabelText(/pengumuman 1/i)).toHaveValue('Satu'));
    expect(screen.getByLabelText(/pengumuman 2/i)).toHaveValue('Dua');
    expect(screen.getByRole('button', { name: /simpan pengumuman/i })).toBeEnabled();
    expect(screen.queryByText(/pengumuman tidak dapat dimuat/i)).not.toBeInTheDocument();
  });
});

describe('Admin Layar: token layar (tidak berubah)', () => {
  it('daftar token aktif tampil dan Buat Token memanggil API', async () => {
    const mock = pasang({
      tokens: [{ id: 't1', token: 'abcdefghijklmnop', nama: 'Layar Lobby', aktif: true, created_at: '2026-11-01T00:00:00Z' }],
    });
    render(<AdminLayarPage />);
    expect(await screen.findByText('Layar Lobby')).toBeInTheDocument();
    expect(screen.getByText(/Layar Aktif \(1\)/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/nama layar/i), { target: { value: 'Layar Baru' } });
    fireEvent.click(screen.getByRole('button', { name: /buat token/i }));
    await waitFor(() =>
      expect(mock.fetchMock).toHaveBeenCalledWith('/api/admin/layar', expect.objectContaining({ method: 'POST' })),
    );
  });
});
