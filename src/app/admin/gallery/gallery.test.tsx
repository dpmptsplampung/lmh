// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

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

import AdminGalleryPage from './page';
import { createClient } from '@/lib/supabase/client';

function buildMock() {
  const order = vi.fn().mockResolvedValue({ data: [], error: null });
  const select = vi.fn().mockReturnValue({ order });
  const storageUpload = vi.fn().mockResolvedValue({ error: null });
  const insert = vi.fn().mockResolvedValue({ error: null });

  const mock = {
    from: vi.fn((table: string) => {
      if (table === 'investment_documents') {
        return {
          select,
          insert,
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
          delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        };
      }
      return {};
    }),
    storage: {
      from: vi.fn(() => ({
        upload: storageUpload,
        remove: vi.fn().mockResolvedValue({ error: null }),
      })),
    },
    _storageUpload: storageUpload,
    _insert: insert,
    _select: select,
  };

  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mock);
  return mock;
}

describe('Admin gallery PDF pipeline', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 'doc-1', jumlah_halaman: 2, halaman_selesai: 2, selesai: true, uploadUrl: 'https://r2.example/put', kunci: 'investment-docs/raw/test.pdf', headers: { 'Content-Type': 'application/pdf' } }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
  });

  it('memuat daftar dengan kolom eksplisit yang dibaca halaman (bukan select("*"))', async () => {
    const mock = buildMock();
    render(<AdminGalleryPage />);
    await waitFor(() => expect(mock._select).toHaveBeenCalledTimes(1));
    const kolom = mock._select.mock.calls[0][0] as string;
    expect(kolom).not.toContain('*');
    expect(kolom.split(',').map((k) => k.trim())).toEqual([
      'id', 'judul', 'kategori', 'urutan_tampil', 'file_path', 'jumlah_halaman', 'status', 'deskripsi', 'nilai_investasi', 'image_url', 'halaman_selesai', 'galat',
    ]);
  });

  it('unggah PDF langsung ke R2, konfirmasi, buat catatan, lalu render bertahap', async () => {
    const mock = buildMock();
    render(<AdminGalleryPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /tambah dokumen/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /tambah dokumen/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/judul/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/judul/i), {
      target: { value: 'Proyek Baru' },
    });

    const file = new File(['%PDF-1.4 fake'], 'proyek.pdf', { type: 'application/pdf' });
    const fileInput = screen.getByLabelText(/file pdf/i) as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(5));
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map(c => c[0])).toEqual(['/api/storage/presign', 'https://r2.example/put', '/api/storage/konfirmasi', '/api/investment-docs', '/api/investment-docs/doc-1/render']);
    expect(calls[1][1]).toMatchObject({ method: 'PUT', body: file });
    expect(JSON.parse(calls[0][1].body)).toMatchObject({ area: 'investment-docs', mime: 'application/pdf', ukuran: file.size });
    expect(JSON.parse(calls[0][1].body)).not.toHaveProperty('path');
    expect(JSON.parse(calls[2][1].body)).toEqual({ area: 'investment-docs', path: 'raw/test.pdf' });
    expect(JSON.parse(calls[3][1].body)).toMatchObject({ judul: 'Proyek Baru', kunci: 'investment-docs/raw/test.pdf' });
    expect(JSON.parse(calls[4][1].body)).toEqual({ mulai: 1 });
    expect(mock._storageUpload).not.toHaveBeenCalled();
    expect(mock._insert).not.toHaveBeenCalled();
  });

  it('dokumen gagal dapat dilanjutkan dari halaman tersimpan dengan kemajuan aksesibel', async () => {
    const mock = buildMock();
    mock._select.mockReturnValue({ order: vi.fn().mockResolvedValue({ data: [{
      id: 'doc-gagal', judul: 'Kajian Terputus', kategori: null, urutan_tampil: 1,
      file_path: 'raw/uji.pdf', jumlah_halaman: 3, halaman_selesai: 1, status: 'gagal',
      deskripsi: null, nilai_investasi: null, image_url: null, galat: 'Pemrosesan terhenti.',
    }], error: null }) });
    let selesai!: (r: unknown) => void;
    globalThis.fetch = vi.fn(() => new Promise(resolve => { selesai = resolve; })) as typeof fetch;
    render(<AdminGalleryPage />);
    const lanjut = await screen.findByRole('button', { name: 'Lanjutkan pemrosesan' });
    expect(screen.queryByTitle('Aktifkan')).not.toBeInTheDocument();
    fireEvent.click(lanjut);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/investment-docs/doc-gagal/render');
    expect(JSON.parse(init.body)).toEqual({ mulai: 2 });
    expect(screen.getByRole('progressbar', { name: 'Kemajuan pemrosesan PDF' })).toHaveAttribute('value', '1');
    selesai({ ok: true, json: async () => ({ halaman_selesai: 3, jumlah_halaman: 3, selesai: true }) });
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
  });

  it('delete path calls DELETE /api/investment-docs/:id (not client DB delete)', async () => {
    const mock = buildMock();
    const order = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'doc-del-1',
          judul: 'Dokumen Hapus',
          kategori: null,
          urutan_tampil: 1,
          file_path: '_raw/x.pdf',
          jumlah_halaman: 1,
          status: 'aktif',
          deskripsi: null,
          nilai_investasi: null,
          image_url: null,
          created_at: '2026-01-01',
        },
      ],
      error: null,
    });
    mock.from = vi.fn((table: string) => {
      if (table === 'investment_documents') {
        return {
          select: vi.fn().mockReturnValue({ order }),
          insert: mock._insert,
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation(() => {
              throw new Error('client delete must not be used');
            }),
          }),
        };
      }
      return {};
    });

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    render(<AdminGalleryPage />);

    await waitFor(() => {
      expect(screen.getByText('Dokumen Hapus')).toBeInTheDocument();
    });

    const deleteBtn = screen.getByTitle('Hapus');
    fireEvent.click(deleteBtn);
    expect(globalThis.fetch).not.toHaveBeenCalledWith(expect.stringContaining('/api/investment-docs/doc-del-1'), expect.anything());
    fireEvent.click(await screen.findByRole('button', { name: 'Ya, hapus' }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/investment-docs/doc-del-1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  it('form: kategori pilihan tetap, kontrol file berbahasa Indonesia, status hanya saat edit, jumlah halaman otomatis', async () => {
    const mock = buildMock();
    mock._select.mockReturnValue({ order: vi.fn().mockResolvedValue({ data: [{
      id: 'doc-lama', judul: 'Dokumen Lama', kategori: 'Manufaktur & Industri', urutan_tampil: 1, file_path: 'raw/x.pdf',
      jumlah_halaman: 5, halaman_selesai: 5, status: 'aktif', deskripsi: null, nilai_investasi: null, image_url: null, galat: null,
    }], error: null }) });
    render(<AdminGalleryPage />);
    // Ringkasan satu baris, bukan dua kartu statistik.
    expect(await screen.findByLabelText('Ringkasan dokumen')).toHaveTextContent('1 aktif');
    fireEvent.click(screen.getByRole('button', { name: /tambah dokumen/i }));
    const kategori = await screen.findByLabelText('Kategori') as HTMLSelectElement;
    expect([...kategori.options].map(o => o.textContent)).toEqual(['Pilih kategori', 'Peta Potensi', 'Kajian', 'Profil', 'Lainnya']);
    expect(screen.getByText('Pilih file PDF')).toBeInTheDocument();
    expect(screen.getByText('Belum ada file dipilih')).toBeInTheDocument();
    expect(screen.queryByLabelText('Status')).toBeNull();
    expect(screen.queryByLabelText('Jumlah Halaman')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Batal' }));
    fireEvent.click(await screen.findByTitle('Edit'));
    expect(await screen.findByLabelText('Status')).toBeInTheDocument();
    // Nilai kategori lama tetap terbaca sampai staf memilih kategori baru.
    expect(screen.getByText(/Kategori lama: "Manufaktur & Industri"/)).toBeInTheDocument();
    expect(screen.getByText(/Jumlah halaman: 5/)).toBeInTheDocument();
  });
});
