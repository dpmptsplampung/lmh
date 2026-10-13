// @vitest-environment jsdom
// Audit T2d: publikasi/hapus/edit listing dan tautan pemilik UMKM harus dicek. Penolakan RLS pada
// UPDATE/DELETE = 0 baris tanpa error -> jangan lapor sukses palsu.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';

type DbError = { message: string; code?: string };
type Hasil = { data: { id: string }[] | null; error: DbError | null };

const h = vi.hoisted(() => ({
  toast: vi.fn(),
  listingSelects: vi.fn(),
  ownerSelects: vi.fn(),
  writes: vi.fn(),
  state: {
    listings: [] as unknown[],
    owners: [] as unknown[],
    updateResult: { data: [{ id: 'x' }], error: null } as Hasil,
    listingDeleteResult: { data: [{ id: 'x' }], error: null } as Hasil,
    ownerDeleteResult: { data: [{ id: 'x' }], error: null } as Hasil,
    // upsert tanpa .select(): supabase-js tidak mengembalikan baris -> data null walau berhasil
    upsertResult: { data: null, error: null } as { data: null; error: DbError | null },
  },
}));

vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock('@/components/layout/PageHeader', () => ({
  default: ({ title, children }: { title: string; children?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element -- test mock for next/image
  default: (props: { alt?: string }) => <img alt={props.alt ?? ''} />,
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    storage: { from: () => ({ upload: vi.fn(), getPublicUrl: vi.fn() }) },
    from: (table: string) => ({
      select: () => {
        if (table === 'umkm_listing_owner') {
          h.ownerSelects();
          return Promise.resolve({ data: h.state.owners, error: null });
        }
        return {
          order: () => {
            h.listingSelects();
            return Promise.resolve({ data: h.state.listings, error: null });
          },
        };
      },
      update: (payload: Record<string, unknown>) => ({
        eq: (_kolom: string, id: string) => ({
          select: () => {
            h.writes('update', table, id, payload);
            return Promise.resolve(h.state.updateResult);
          },
        }),
      }),
      delete: () => ({
        eq: (_kolom: string, id: string) => ({
          select: () => {
            h.writes('delete', table, id);
            return Promise.resolve(
              table === 'listing_umkm' ? h.state.listingDeleteResult : h.state.ownerDeleteResult,
            );
          },
        }),
      }),
      upsert: (values: unknown, opts: unknown) => {
        h.writes('upsert', table, values, opts);
        return Promise.resolve(h.state.upsertResult);
      },
    }),
  }),
}));

import AdminUMKMPage from './page';

const listing = (over: Record<string, unknown> = {}) => ({
  id: 'L1',
  nama_umkm: 'Toko Sejahtera',
  kategori_kebutuhan: 'bahan_baku',
  sisi: 'penawaran',
  deskripsi: 'Deskripsi toko',
  foto_produk: [],
  kontak_nama: 'Siti',
  kontak_hp: null,
  kontak_email: null,
  status: 'pending_review',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  ...over,
});

const owner = (over: Record<string, unknown> = {}) => ({
  id: 'O1',
  listing_id: 'L1',
  email: 'pemilik@example.com',
  created_at: '2026-10-01T00:00:00Z',
  ...over,
});

const baris = (nama: string) => screen.getByText(nama).closest('tr') as HTMLElement;

describe('Admin UMKM: mutasi dicek (tidak ada sukses palsu)', () => {
  beforeEach(() => {
    h.toast.mockClear();
    h.listingSelects.mockClear();
    h.ownerSelects.mockClear();
    h.writes.mockClear();
    h.state.listings = [listing()];
    h.state.owners = [];
    h.state.updateResult = { data: [{ id: 'L1' }], error: null };
    h.state.listingDeleteResult = { data: [{ id: 'L1' }], error: null };
    h.state.ownerDeleteResult = { data: [{ id: 'O1' }], error: null };
    h.state.upsertResult = { data: null, error: null };
  });
  afterEach(cleanup);

  describe('publikasi / tolak (status)', () => {
    it('0 baris terdampak (RLS menolak diam-diam) -> toast gagal, status di layar TIDAK berubah, daftar dimuat ulang', async () => {
      h.state.updateResult = { data: [], error: null };
      render(<AdminUMKMPage />);
      await screen.findByText('Toko Sejahtera');

      fireEvent.click(within(baris('Toko Sejahtera')).getByTitle('Approve'));

      await waitFor(() =>
        expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('Gagal memperbarui status'), 'error'),
      );
      expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
      expect(within(baris('Toko Sejahtera')).getByText(/Pending/)).toBeInTheDocument();
      await waitFor(() => expect(h.listingSelects).toHaveBeenCalledTimes(2));
    });

    it('error jaringan -> toast gagal, status tidak berubah, tanpa muat ulang', async () => {
      h.state.updateResult = { data: null, error: { message: 'TypeError: Failed to fetch', code: '' } };
      render(<AdminUMKMPage />);
      await screen.findByText('Toko Sejahtera');

      fireEvent.click(within(baris('Toko Sejahtera')).getByTitle('Approve'));

      await waitFor(() =>
        expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('Koneksi bermasalah'), 'error'),
      );
      expect(within(baris('Toko Sejahtera')).getByText(/Pending/)).toBeInTheDocument();
      expect(h.listingSelects).toHaveBeenCalledTimes(1);
    });

    it('berhasil (baris terbukti) -> status Published + toast sukses; payload mereset snapshot_approved', async () => {
      render(<AdminUMKMPage />);
      await screen.findByText('Toko Sejahtera');

      fireEvent.click(within(baris('Toko Sejahtera')).getByTitle('Approve'));

      await waitFor(() =>
        expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('berhasil diperbarui'), 'success'),
      );
      expect(within(baris('Toko Sejahtera')).getByText(/Published/)).toBeInTheDocument();
      expect(h.writes).toHaveBeenCalledWith(
        'update',
        'listing_umkm',
        'L1',
        expect.objectContaining({ status: 'published', snapshot_approved: null }),
      );
    });
  });

  describe('hapus listing', () => {
    beforeEach(() => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
    });

    it('0 baris terhapus -> toast gagal, baris TETAP tampil, daftar dimuat ulang', async () => {
      h.state.listingDeleteResult = { data: [], error: null };
      render(<AdminUMKMPage />);
      await screen.findByText('Toko Sejahtera');

      fireEvent.click(within(baris('Toko Sejahtera')).getByTitle('Hapus'));

      await waitFor(() =>
        expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('Gagal menghapus listing'), 'error'),
      );
      expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
      expect(screen.getByText('Toko Sejahtera')).toBeInTheDocument();
      await waitFor(() => expect(h.listingSelects).toHaveBeenCalledTimes(2));
    });

    it('berhasil -> baris hilang + toast sukses', async () => {
      render(<AdminUMKMPage />);
      await screen.findByText('Toko Sejahtera');

      fireEvent.click(within(baris('Toko Sejahtera')).getByTitle('Hapus'));

      await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Listing UMKM berhasil dihapus.', 'success'));
      expect(screen.queryByText('Toko Sejahtera')).toBeNull();
    });
  });

  describe('edit listing (modal)', () => {
    const bukaEditDanSimpan = async () => {
      render(<AdminUMKMPage />);
      await screen.findByText('Toko Sejahtera');
      fireEvent.click(within(baris('Toko Sejahtera')).getByTitle('Edit'));
      fireEvent.change(await screen.findByLabelText(/nama umkm/i), { target: { value: 'Toko Revisi' } });
      fireEvent.click(screen.getByRole('button', { name: /^simpan$/i }));
    };

    it('0 baris -> modal tetap terbuka dengan galat jujur, BUKAN "berhasil diperbarui", daftar tak berubah', async () => {
      h.state.updateResult = { data: [], error: null };
      await bukaEditDanSimpan();

      await waitFor(() =>
        expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('tidak berwenang'), 'error'),
      );
      expect(h.toast).not.toHaveBeenCalledWith('UMKM berhasil diperbarui.', 'success');
      expect(document.querySelector('.form-error')?.textContent).toContain('Gagal menyimpan data');
      expect((screen.getByLabelText(/nama umkm/i) as HTMLInputElement).value).toBe('Toko Revisi');
      expect(screen.queryByText('Toko Revisi', { selector: 'div' })).toBeNull();
    });

    it('berhasil -> modal tertutup, daftar menampilkan nama baru, toast sukses', async () => {
      await bukaEditDanSimpan();

      await waitFor(() => expect(h.toast).toHaveBeenCalledWith('UMKM berhasil diperbarui.', 'success'));
      expect(h.writes).toHaveBeenCalledWith(
        'update',
        'listing_umkm',
        'L1',
        expect.objectContaining({ nama_umkm: 'Toko Revisi' }),
      );
      expect(await screen.findByText('Toko Revisi')).toBeInTheDocument();
      expect(screen.queryByLabelText(/nama umkm/i)).toBeNull();
    });
  });

  describe('pemilik listing', () => {
    const bukaModalPemilik = async () => {
      render(<AdminUMKMPage />);
      await screen.findByText('Toko Sejahtera');
      fireEvent.click(within(baris('Toko Sejahtera')).getByTitle('Lihat'));
    };

    it('tautkan: upsert ignoreDuplicates (ON CONFLICT DO NOTHING) tanpa baris baru = SAH -> toast ditautkan', async () => {
      // data null + error null: pemilik yang sudah tertaut tidak menambah baris, tetapi tujuannya (tertaut) tercapai.
      await bukaModalPemilik();
      fireEvent.change(await screen.findByLabelText('Email pemilik'), { target: { value: 'Baru@Example.com' } });
      fireEvent.click(screen.getByRole('button', { name: /tautkan/i }));

      await waitFor(() =>
        expect(h.toast).toHaveBeenCalledWith('Pemilik baru@example.com berhasil ditautkan.', 'success'),
      );
      expect(h.writes).toHaveBeenCalledWith(
        'upsert',
        'umkm_listing_owner',
        { listing_id: 'L1', email: 'baru@example.com' },
        { onConflict: 'listing_id,email', ignoreDuplicates: true },
      );
    });

    it('tautkan: ditolak RLS (42501) -> toast gagal, BUKAN ditautkan', async () => {
      h.state.upsertResult = {
        data: null,
        error: { message: 'new row violates row-level security policy for table "umkm_listing_owner"', code: '42501' },
      };
      await bukaModalPemilik();
      fireEvent.change(await screen.findByLabelText('Email pemilik'), { target: { value: 'baru@example.com' } });
      fireEvent.click(screen.getByRole('button', { name: /tautkan/i }));

      await waitFor(() =>
        expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('Gagal menautkan pemilik'), 'error'),
      );
      expect(h.toast).not.toHaveBeenCalledWith(expect.stringContaining('berhasil ditautkan'), 'success');
    });

    it('cabut tautan: 0 baris -> toast gagal, pemilik TETAP tampil, data dimuat ulang', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      h.state.owners = [owner()];
      h.state.ownerDeleteResult = { data: [], error: null };
      await bukaModalPemilik();

      fireEvent.click(await screen.findByTitle('Hapus tautan pemilik'));

      await waitFor(() =>
        expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('Gagal menghapus tautan pemilik'), 'error'),
      );
      expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
      expect(screen.getAllByText('pemilik@example.com').length).toBeGreaterThan(0);
      await waitFor(() => expect(h.ownerSelects).toHaveBeenCalledTimes(2));
    });

    it('cabut tautan: berhasil -> pemilik hilang + toast sukses', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      h.state.owners = [owner()];
      await bukaModalPemilik();

      fireEvent.click(await screen.findByTitle('Hapus tautan pemilik'));

      await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Tautan pemilik berhasil dihapus.', 'success'));
      expect(screen.queryAllByText('pemilik@example.com')).toHaveLength(0);
    });
  });
});
