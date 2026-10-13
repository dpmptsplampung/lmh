// @vitest-environment jsdom
// Audit T2d: simpan konten landing = banyak UPDATE paralel (satu per item). Penolakan RLS = 0 baris tanpa
// error -> jangan lapor "berhasil disimpan"; kegagalan sebagian harus dilaporkan jujur.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

type DbError = { message: string; code?: string };
type UpdateResult = { data: { id: string }[] | null; error: DbError | null };

const h = vi.hoisted(() => ({
  toast: vi.fn(),
  selects: vi.fn(),
  updates: [] as { id: string; payload: Record<string, unknown> }[],
  state: {
    items: [] as unknown[],
    updateResult: ((id: string) => ({ data: [{ id }], error: null })) as (id: string) => UpdateResult,
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
      // dua .order() berantai: order('section') -> order('item_order')
      select: () => ({
        order: () => ({
          order: () => {
            h.selects();
            return Promise.resolve({ data: h.state.items, error: null });
          },
        }),
      }),
      update: (payload: Record<string, unknown>) => ({
        eq: (_kolom: string, id: string) => ({
          select: () => {
            h.updates.push({ id, payload });
            return Promise.resolve(h.state.updateResult(id));
          },
        }),
      }),
    }),
  }),
}));

import LandingContentEditorPage from './page';

const item = (id: string, key: string, value: string, order = 1) => ({
  id,
  section: 'hero',
  item_key: key,
  item_value: value,
  item_order: order,
  is_active: true,
});

async function bukaDanSimpan() {
  render(<LandingContentEditorPage />);
  const tombol = await screen.findByRole('button', { name: /Simpan Perubahan/i });
  fireEvent.click(tombol);
}

describe('Admin landing: simpan konten dicek (tidak ada sukses palsu)', () => {
  beforeEach(() => {
    h.toast.mockClear();
    h.selects.mockClear();
    h.updates.length = 0;
    h.state.items = [item('i1', 'title', 'Judul'), item('i2', 'subtitle', 'Subjudul', 2)];
    h.state.updateResult = (id) => ({ data: [{ id }], error: null });
  });
  afterEach(cleanup);

  it('semua item terbukti tersimpan -> toast sukses', async () => {
    await bukaDanSimpan();
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith('Konten "Hero" berhasil disimpan!', 'success'),
    );
    expect(h.updates.map((u) => u.id).sort()).toEqual(['i1', 'i2']);
    expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'error');
  });

  it('semua item 0 baris (RLS menolak diam-diam) -> toast gagal jelas, BUKAN sukses', async () => {
    h.state.updateResult = () => ({ data: [], error: null });
    await bukaDanSimpan();
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('tidak berwenang'), 'error'),
    );
    expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
  });

  it('sebagian item gagal -> pesan jujur sebagian (n dari m), BUKAN sukses; semua item tetap dicoba', async () => {
    h.state.updateResult = (id) => (id === 'i2' ? { data: [], error: null } : { data: [{ id }], error: null });
    await bukaDanSimpan();
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('1 dari 2'), 'error'),
    );
    expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
    // Promise.allSettled: kegagalan satu item tidak membatalkan item lain
    expect(h.updates).toHaveLength(2);
  });

  it('error DB -> toast gagal, BUKAN sukses', async () => {
    h.state.updateResult = () => ({ data: null, error: { message: 'boom', code: 'XX000' } });
    await bukaDanSimpan();
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('Gagal menyimpan konten'), 'error'),
    );
    expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
  });

  it('setelah gagal, isian pengguna TIDAK hilang dan tidak dimuat ulang (agar bisa disimpan ulang)', async () => {
    h.state.updateResult = () => ({ data: [], error: null });
    render(<LandingContentEditorPage />);
    const input = (await screen.findByDisplayValue('Judul')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Judul Baru' } });
    fireEvent.click(screen.getByRole('button', { name: /Simpan Perubahan/i }));

    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.anything(), 'error'));
    expect((screen.getByDisplayValue('Judul Baru') as HTMLInputElement).value).toBe('Judul Baru');
    expect(h.selects).toHaveBeenCalledTimes(1);
  });
});
