// @vitest-environment jsdom
// Editor blok homepage (Fase 2). Simpan = satu upsert 7 baris yang DICEK (0 baris karena RLS = galat, bukan
// "berhasil"); kegagalan tidak membuang isian pengguna.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';

type DbError = { message: string; code?: string };
type HasilUpsert = { data: { jenis: string }[] | null; error: DbError | null };

const h = vi.hoisted(() => ({
  toast: vi.fn(),
  selects: vi.fn(),
  upserts: [] as { rows: Array<Record<string, unknown>>; opsi: Record<string, unknown> }[],
  state: {
    rows: [] as unknown,
    selectError: null as DbError | null,
    upsertResult: ((rows: Array<{ jenis: string }>) => ({ data: rows.map((r) => ({ jenis: r.jenis })), error: null })) as (
      rows: Array<{ jenis: string }>,
    ) => HasilUpsert,
  },
}));

vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock('@/components/layout/PageHeader', () => ({ default: () => null }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => {
        h.selects();
        return Promise.resolve({ data: h.state.selectError ? null : h.state.rows, error: h.state.selectError });
      },
      upsert: (rows: Array<Record<string, unknown>>, opsi: Record<string, unknown>) => ({
        select: () => {
          h.upserts.push({ rows, opsi });
          return Promise.resolve(h.state.upsertResult(rows as Array<{ jenis: string }>));
        },
      }),
    }),
  }),
}));

import EditorBlokHomepagePage from './page';

const baris = (jenis: string, aktif: boolean, urutan: number, teks: Record<string, string> = {}) => ({ jenis, aktif, urutan, teks });
const SEMUA = [
  baris('hero', true, 10, { description: 'Deskripsi hero kustom' }),
  baris('jalur_cepat', true, 20),
  baris('status_hari_ini', true, 30),
  baris('layanan', true, 40),
  baris('papan_kinerja', false, 50),
  baris('ajakan', true, 60),
  baris('footer', true, 70),
];

const simpan = () => fireEvent.click(screen.getByRole('button', { name: /Simpan Perubahan/i }));
const kartu = (judul: RegExp) => screen.getByRole('group', { name: judul });

describe('Admin editor blok homepage', () => {
  beforeEach(() => {
    h.toast.mockClear();
    h.selects.mockClear();
    h.upserts.length = 0;
    h.state.rows = SEMUA;
    h.state.selectError = null;
    h.state.upsertResult = (rows) => ({ data: rows.map((r) => ({ jenis: r.jenis })), error: null });
  });
  afterEach(cleanup);

  it('memuat tujuh blok berurutan; footer tidak bisa dipindah; papan kinerja mati + catatan belum tersedia', async () => {
    render(<EditorBlokHomepagePage />);
    await screen.findByRole('group', { name: /Hero/ });
    expect(screen.getAllByRole('group')).toHaveLength(7);
    const footer = kartu(/Footer/);
    expect(within(footer).queryByRole('button', { name: /naik|turun/i })).toBeNull();
    const papan = kartu(/Papan kinerja/);
    expect(within(papan).getByRole('checkbox', { name: /Tampilkan blok/ })).not.toBeChecked();
    expect(within(papan).getByText(/belum tersedia/i)).toBeInTheDocument();
    expect(within(kartu(/Hero/)).getByDisplayValue('Deskripsi hero kustom')).toBeInTheDocument();
  });

  it('tabel belum ada: pesan migrasi, editor tetap tampil dengan bawaan, tombol simpan nonaktif', async () => {
    h.state.selectError = { message: 'relation "homepage_blok" does not exist', code: '42P01' };
    render(<EditorBlokHomepagePage />);
    expect(await screen.findByText(/migrasi 202610280001/)).toBeInTheDocument();
    expect(screen.getAllByRole('group')).toHaveLength(7);
    expect(screen.getByRole('button', { name: /Simpan Perubahan/i })).toBeDisabled();
  });

  it('PGRST205 (tabel tak ada di schema cache) juga dianggap migrasi belum diterapkan', async () => {
    h.state.selectError = { message: "Could not find the table 'public.homepage_blok' in the schema cache", code: 'PGRST205' };
    render(<EditorBlokHomepagePage />);
    expect(await screen.findByText(/migrasi 202610280001/)).toBeInTheDocument();
  });

  it('galat baca lain (mis. timeout): pesan galat + Coba lagi, BUKAN pesan migrasi; simpan nonaktif agar bawaan tidak menimpa data', async () => {
    h.state.selectError = { message: 'canceling statement due to statement timeout', code: '57014' };
    render(<EditorBlokHomepagePage />);
    expect(await screen.findByText(/Gagal memuat blok homepage/)).toBeInTheDocument();
    expect(screen.queryByText(/migrasi 202610280001/)).toBeNull();
    expect(screen.getByRole('button', { name: /Simpan Perubahan/i })).toBeDisabled();
    h.state.selectError = null;
    fireEvent.click(screen.getByRole('button', { name: /Coba lagi/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Simpan Perubahan/i })).toBeEnabled());
    expect(screen.queryByText(/Gagal memuat blok homepage/)).toBeNull();
    expect(h.selects).toHaveBeenCalledTimes(2);
  });

  it('simpan: satu upsert 7 baris onConflict jenis, urutan 10..70, hanya teks yang diisi', async () => {
    render(<EditorBlokHomepagePage />);
    await screen.findByRole('group', { name: /Hero/ });
    simpan();
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Blok homepage berhasil disimpan!', 'success'));
    expect(h.upserts).toHaveLength(1);
    const { rows, opsi } = h.upserts[0];
    expect(opsi).toEqual({ onConflict: 'jenis' });
    expect(rows.map((r) => r.jenis)).toEqual(['hero', 'jalur_cepat', 'status_hari_ini', 'layanan', 'papan_kinerja', 'ajakan', 'footer']);
    expect(rows.map((r) => r.urutan)).toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(rows[0].teks).toEqual({ description: 'Deskripsi hero kustom' });
    expect(rows[1].teks).toEqual({});
    expect(rows[4].aktif).toBe(false);
  });

  it('menyalakan blok, mengubah teks, dan memindah blok memengaruhi data tersimpan', async () => {
    render(<EditorBlokHomepagePage />);
    await screen.findByRole('group', { name: /Hero/ });
    fireEvent.click(within(kartu(/Papan kinerja/)).getByRole('checkbox', { name: /Tampilkan blok/ }));
    fireEvent.change(within(kartu(/Papan kinerja/)).getByLabelText('Judul'), { target: { value: '  Kinerja  ' } });
    fireEvent.click(within(kartu(/Ajakan bertindak/)).getByRole('button', { name: /Naikkan/ }));
    simpan();
    await waitFor(() => expect(h.upserts).toHaveLength(1));
    const rows = h.upserts[0].rows;
    const urut = rows.map((r) => r.jenis);
    expect(urut.indexOf('ajakan')).toBeLessThan(urut.indexOf('papan_kinerja'));
    expect(urut[urut.length - 1]).toBe('footer');
    const papan = rows.find((r) => r.jenis === 'papan_kinerja')!;
    expect(papan.aktif).toBe(true);
    expect(papan.teks).toEqual({ title: 'Kinerja' });
  });

  it('tautan yang tidak aman ditolak di klien tanpa menyimpan', async () => {
    render(<EditorBlokHomepagePage />);
    await screen.findByRole('group', { name: /Hero/ });
    fireEvent.change(within(kartu(/Ajakan bertindak/)).getByLabelText(/Tombol: tautan/), { target: { value: 'javascript:alert(1)' } });
    simpan();
    expect(await screen.findByText(/diawali \/ atau https:\/\//)).toBeInTheDocument();
    expect(h.upserts).toHaveLength(0);
  });

  it('0 baris (RLS menolak diam-diam) -> toast gagal jelas, BUKAN sukses', async () => {
    h.state.upsertResult = () => ({ data: [], error: null });
    render(<EditorBlokHomepagePage />);
    await screen.findByRole('group', { name: /Hero/ });
    simpan();
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('tidak berwenang'), 'error'));
    expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
  });

  it('sebagian baris tersimpan -> pesan jujur sebagian, BUKAN sukses', async () => {
    h.state.upsertResult = (rows) => ({ data: rows.slice(0, 4).map((r) => ({ jenis: r.jenis })), error: null });
    render(<EditorBlokHomepagePage />);
    await screen.findByRole('group', { name: /Hero/ });
    simpan();
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('4 dari 7'), 'error'));
    expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
  });

  it('error DB -> toast gagal, BUKAN sukses', async () => {
    h.state.upsertResult = () => ({ data: null, error: { message: 'boom', code: 'XX000' } });
    render(<EditorBlokHomepagePage />);
    await screen.findByRole('group', { name: /Hero/ });
    simpan();
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('Gagal menyimpan'), 'error'));
    expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
  });

  it('setelah gagal, isian pengguna TIDAK hilang dan tidak dimuat ulang', async () => {
    h.state.upsertResult = () => ({ data: [], error: null });
    render(<EditorBlokHomepagePage />);
    const input = (await screen.findByDisplayValue('Deskripsi hero kustom')) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Teks baru' } });
    simpan();
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.anything(), 'error'));
    expect((screen.getByDisplayValue('Teks baru') as HTMLTextAreaElement).value).toBe('Teks baru');
    expect(h.selects).toHaveBeenCalledTimes(1);
  });
});
