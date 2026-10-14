// @vitest-environment jsdom
// Audit T2d: mutasi investment_documents (status, tukar urutan 2 langkah, edit) harus dicek.
// supabase-js tidak melempar; penolakan RLS pada UPDATE = 0 baris tanpa error -> jangan lapor sukses palsu.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';

type DbError = { message: string; code?: string };
type UpdateResult = { data: { id: string }[] | null; error: DbError | null };
type Doc = {
  id: string;
  judul: string;
  kategori: string | null;
  urutan_tampil: number;
  file_path: string;
  jumlah_halaman: number;
  status: 'aktif' | 'nonaktif';
  deskripsi: string | null;
  nilai_investasi: string | null;
  image_url: string | null;
  created_at: string;
  updated_at: string;
};

const h = vi.hoisted(() => ({
  toast: vi.fn(),
  selects: vi.fn(),
  updates: [] as { id: string; payload: Record<string, unknown> }[],
  state: {
    docs: [] as unknown[],
    // Hasil tiap UPDATE (berurutan menurut panggilan ke-n, 0-based).
    updateResult: ((id: string) => ({ data: [{ id }], error: null })) as (
      id: string,
      payload: Record<string, unknown>,
      n: number,
    ) => UpdateResult,
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
    from: () => ({
      select: () => ({
        order: () => {
          h.selects();
          return Promise.resolve({ data: h.state.docs, error: null });
        },
      }),
      update: (payload: Record<string, unknown>) => ({
        eq: (_kolom: string, id: string) => ({
          select: () => {
            const n = h.updates.length;
            h.updates.push({ id, payload });
            return Promise.resolve(h.state.updateResult(id, payload, n));
          },
        }),
      }),
    }),
  }),
}));

import AdminGalleryPage from './page';

const doc = (over: Partial<Doc>): Doc => ({
  id: 'd1',
  judul: 'Dokumen A',
  kategori: null,
  urutan_tampil: 1,
  file_path: '_raw/a.pdf',
  jumlah_halaman: 2,
  status: 'aktif',
  deskripsi: null,
  nilai_investasi: null,
  image_url: null,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  ...over,
});

const barisDoc = (judul: string) => screen.getByText(judul).closest('tr') as HTMLElement;

describe('Admin gallery: mutasi dicek (tidak ada sukses palsu)', () => {
  beforeEach(() => {
    h.toast.mockClear();
    h.selects.mockClear();
    h.updates.length = 0;
    h.state.docs = [
      doc({ id: 'dA', judul: 'Dokumen A', urutan_tampil: 1 }),
      doc({ id: 'dB', judul: 'Dokumen B', urutan_tampil: 2 }),
    ];
    h.state.updateResult = (id) => ({ data: [{ id }], error: null });
  });
  afterEach(cleanup);

  describe('ubah status', () => {
    it('0 baris terdampak (RLS menolak diam-diam) -> toast gagal, status di layar TIDAK berubah, daftar dimuat ulang', async () => {
      h.state.updateResult = () => ({ data: [], error: null });
      render(<AdminGalleryPage />);
      await screen.findByText('Dokumen A');

      fireEvent.click(within(barisDoc('Dokumen A')).getByTitle('Nonaktifkan'));

      await waitFor(() =>
        expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('Gagal mengubah status dokumen'), 'error'),
      );
      expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
      // tampilan tetap menunjukkan Aktif (state tidak dimutasi seolah berhasil)
      expect(within(barisDoc('Dokumen A')).getByText(/Aktif/)).toBeInTheDocument();
      // 0 baris = tampilan kemungkinan basi -> muat ulang (1x awal + 1x ulang)
      await waitFor(() => expect(h.selects).toHaveBeenCalledTimes(2));
    });

    it('error jaringan -> toast gagal, tanpa muat ulang, status tidak berubah', async () => {
      h.state.updateResult = () => ({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' } });
      render(<AdminGalleryPage />);
      await screen.findByText('Dokumen A');

      fireEvent.click(within(barisDoc('Dokumen A')).getByTitle('Nonaktifkan'));

      await waitFor(() =>
        expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('Gagal mengubah status dokumen'), 'error'),
      );
      expect(within(barisDoc('Dokumen A')).getByText(/Aktif/)).toBeInTheDocument();
      expect(h.selects).toHaveBeenCalledTimes(1);
    });

    it('berhasil (baris terbukti) -> status berubah + toast sukses', async () => {
      render(<AdminGalleryPage />);
      await screen.findByText('Dokumen A');

      fireEvent.click(within(barisDoc('Dokumen A')).getByTitle('Nonaktifkan'));

      await waitFor(() =>
        expect(h.toast).toHaveBeenCalledWith('Status berhasil diubah menjadi nonaktif.', 'success'),
      );
      expect(within(barisDoc('Dokumen A')).getByText('Nonaktif')).toBeInTheDocument();
      expect(h.updates[0]).toMatchObject({ id: 'dA', payload: { status: 'nonaktif' } });
    });
  });

  describe('tukar urutan (2 UPDATE berurutan, non-atomik)', () => {
    it('sukses: kedua langkah terbukti -> urutan tertukar di layar, tanpa toast gagal & tanpa muat ulang', async () => {
      render(<AdminGalleryPage />);
      await screen.findByText('Dokumen A');

      fireEvent.click(within(barisDoc('Dokumen A')).getByTitle('Pindah ke bawah'));

      await waitFor(() => expect(within(barisDoc('Dokumen A')).getByText('2')).toBeInTheDocument());
      expect(within(barisDoc('Dokumen B')).getByText('1')).toBeInTheDocument();
      expect(h.updates).toHaveLength(2);
      // langkah 1: tetangga (B) menerima urutan A; langkah 2: A menerima urutan B
      expect(h.updates[0]).toMatchObject({ id: 'dB', payload: { urutan_tampil: 1 } });
      expect(h.updates[1]).toMatchObject({ id: 'dA', payload: { urutan_tampil: 2 } });
      expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'error');
      expect(h.selects).toHaveBeenCalledTimes(1);
    });

    it('langkah 1 ditolak (0 baris) -> berhenti, langkah 2 tidak dijalankan, toast gagal, daftar dimuat ulang', async () => {
      h.state.updateResult = (_id, _p, n) => (n === 0 ? { data: [], error: null } : { data: [{ id: _id }], error: null });
      render(<AdminGalleryPage />);
      await screen.findByText('Dokumen A');

      fireEvent.click(within(barisDoc('Dokumen A')).getByTitle('Pindah ke bawah'));

      await waitFor(() =>
        expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('Gagal mengubah urutan dokumen'), 'error'),
      );
      expect(h.updates).toHaveLength(1);
      await waitFor(() => expect(h.selects).toHaveBeenCalledTimes(2));
      // layar tidak menampilkan urutan tertukar
      expect(within(barisDoc('Dokumen A')).getByText('1')).toBeInTheDocument();
      expect(within(barisDoc('Dokumen B')).getByText('2')).toBeInTheDocument();
    });

    it('langkah 2 gagal SETELAH langkah 1 sukses -> langkah 1 dibatalkan (dikembalikan), toast gagal, daftar dimuat ulang, layar tidak basi', async () => {
      // n=0 (langkah 1) sukses, n=1 (langkah 2) ditolak, n=2 (pembatalan langkah 1) sukses
      h.state.updateResult = (id, _p, n) => (n === 1 ? { data: [], error: null } : { data: [{ id }], error: null });
      render(<AdminGalleryPage />);
      await screen.findByText('Dokumen A');

      fireEvent.click(within(barisDoc('Dokumen A')).getByTitle('Pindah ke bawah'));

      await waitFor(() =>
        expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('Gagal mengubah urutan dokumen'), 'error'),
      );
      expect(h.updates).toHaveLength(3);
      // pembatalan: tetangga (B) dikembalikan ke urutan semula (2)
      expect(h.updates[2]).toMatchObject({ id: 'dB', payload: { urutan_tampil: 2 } });
      await waitFor(() => expect(h.selects).toHaveBeenCalledTimes(2));
      expect(within(barisDoc('Dokumen A')).getByText('1')).toBeInTheDocument();
      expect(within(barisDoc('Dokumen B')).getByText('2')).toBeInTheDocument();
      expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
    });

    it('langkah 2 gagal dan pembatalan juga gagal -> toast jujur bahwa urutan mungkin tidak konsisten, tetap dimuat ulang', async () => {
      h.state.updateResult = (id, _p, n) => (n >= 1 ? { data: [], error: null } : { data: [{ id }], error: null });
      render(<AdminGalleryPage />);
      await screen.findByText('Dokumen A');

      fireEvent.click(within(barisDoc('Dokumen A')).getByTitle('Pindah ke bawah'));

      await waitFor(() =>
        expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('urutan mungkin tidak konsisten'), 'error'),
      );
      await waitFor(() => expect(h.selects).toHaveBeenCalledTimes(2));
    });

    it('Pindah ke atas memakai pola yang sama (langkah 2 gagal -> batal + muat ulang)', async () => {
      h.state.updateResult = (id, _p, n) => (n === 1 ? { data: [], error: null } : { data: [{ id }], error: null });
      render(<AdminGalleryPage />);
      await screen.findByText('Dokumen B');

      fireEvent.click(within(barisDoc('Dokumen B')).getByTitle('Pindah ke atas'));

      await waitFor(() =>
        expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('Gagal mengubah urutan dokumen'), 'error'),
      );
      expect(h.updates).toHaveLength(3);
      // langkah 1: tetangga (A) menerima urutan B (2); pembatalan: A kembali ke 1
      expect(h.updates[0]).toMatchObject({ id: 'dA', payload: { urutan_tampil: 2 } });
      expect(h.updates[2]).toMatchObject({ id: 'dA', payload: { urutan_tampil: 1 } });
      await waitFor(() => expect(h.selects).toHaveBeenCalledTimes(2));
    });
  });

  describe('edit metadata (modal)', () => {
    const bukaEditDanSimpan = async () => {
      render(<AdminGalleryPage />);
      await screen.findByText('Dokumen A');
      fireEvent.click(within(barisDoc('Dokumen A')).getByTitle('Edit'));
      fireEvent.change(await screen.findByLabelText(/judul/i), { target: { value: 'Dokumen A Revisi' } });
      fireEvent.click(screen.getByRole('button', { name: /^simpan$/i }));
    };

    it('0 baris terdampak -> modal tetap terbuka dengan pesan galat, toast gagal, BUKAN "berhasil disimpan"', async () => {
      h.state.updateResult = () => ({ data: [], error: null });
      await bukaEditDanSimpan();

      await waitFor(() =>
        expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('tidak berwenang'), 'error'),
      );
      expect(h.toast).not.toHaveBeenCalledWith('Dokumen berhasil disimpan.', 'success');
      // modal tidak ditutup & isian tidak hilang
      expect((screen.getByLabelText(/judul/i) as HTMLInputElement).value).toBe('Dokumen A Revisi');
      expect(document.querySelector('.form-error')).not.toBeNull();
    });

    it('berhasil -> modal tertutup + toast sukses + daftar dimuat ulang', async () => {
      await bukaEditDanSimpan();

      await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Dokumen berhasil disimpan.', 'success'));
      expect(h.updates[0]).toMatchObject({ id: 'dA', payload: { judul: 'Dokumen A Revisi' } });
      await waitFor(() => expect(h.selects).toHaveBeenCalledTimes(2));
      expect(screen.queryByLabelText(/judul/i)).toBeNull();
    });
  });
});
