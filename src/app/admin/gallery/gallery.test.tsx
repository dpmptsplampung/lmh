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
      json: async () => ({ id: 'doc-1', jumlah_halaman: 2 }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
  });

  it('create path submits multipart to /api/investment-docs/upload (no client storage.upload)', async () => {
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

    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('/api/investment-docs/upload');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);

    const body = init.body as FormData;
    expect(body.get('judul')).toBe('Proyek Baru');
    expect(body.get('pdf')).toBeInstanceOf(File);

    expect(mock._storageUpload).not.toHaveBeenCalled();
    expect(mock._insert).not.toHaveBeenCalled();
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

    vi.spyOn(window, 'confirm').mockReturnValue(true);
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

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/investment-docs/doc-del-1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });
});
