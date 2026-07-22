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

import AdminUMKMPage from './page';
import { createClient } from '@/lib/supabase/client';

function buildMock() {
  const order = vi.fn().mockResolvedValue({ data: [], error: null });
  const select = vi.fn().mockReturnValue({ order });
  const single = vi.fn().mockResolvedValue({ data: { id: 'new-listing-id' }, error: null });
  const insertSelect = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select: insertSelect });
  const updateEq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq: updateEq });

  const mock = {
    from: vi.fn(() => ({
      select,
      insert,
      update,
      delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
    })),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'http://x/y.jpg' } }),
      })),
    },
    _insert: insert,
    _update: update,
  };

  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mock);
  return mock;
}

async function openCreateFormAndFill() {
  render(<AdminUMKMPage />);

  await waitFor(() => {
    expect(screen.getByRole('button', { name: /tambah umkm/i })).toBeInTheDocument();
  });

  fireEvent.click(screen.getByRole('button', { name: /tambah umkm/i }));

  await waitFor(() => {
    expect(screen.getByLabelText(/sisi/i)).toBeInTheDocument();
  });

  fireEvent.change(screen.getByLabelText(/nama umkm/i), {
    target: { value: 'Toko Sejahtera' },
  });
  fireEvent.change(screen.getByLabelText(/kategori/i), {
    target: { value: 'bahan_baku' },
  });
  fireEvent.change(screen.getByLabelText(/^sisi/i), {
    target: { value: 'penawaran' },
  });
  fireEvent.change(screen.getByLabelText(/nama kontak/i), {
    target: { value: 'Siti' },
  });
}

describe('Admin UMKM sisi field', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('create form includes sisi select and sends sisi in insert payload', async () => {
    const mock = buildMock();
    await openCreateFormAndFill();

    fireEvent.click(screen.getByLabelText(/menyetujui nama & kontaknya/i));
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    await waitFor(() => {
      expect(mock._insert).toHaveBeenCalled();
    });

    const listingCall = mock._insert.mock.calls.find(
      ([payload]) => (payload as Record<string, unknown>).nama_umkm === 'Toko Sejahtera',
    );
    expect(listingCall).toBeDefined();
    expect((listingCall![0] as Record<string, unknown>).sisi).toBe('penawaran');
  });

  it('submit stays disabled until public contact consent is checked', async () => {
    const mock = buildMock();
    await openCreateFormAndFill();

    const submit = screen.getByRole('button', { name: /simpan/i });
    expect(submit).toBeDisabled();

    fireEvent.click(submit);
    expect(mock._insert).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText(/menyetujui nama & kontaknya/i));
    expect(submit).toBeEnabled();
  });

  it('inserts consent_log row after successful create', async () => {
    const mock = buildMock();
    await openCreateFormAndFill();

    fireEvent.click(screen.getByLabelText(/menyetujui nama & kontaknya/i));
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    await waitFor(() => {
      const consentCall = mock._insert.mock.calls.find(
        ([payload]) => (payload as Record<string, unknown>).tujuan === 'umkm_contact_public',
      );
      expect(consentCall).toBeDefined();
      const consentPayload = consentCall![0] as Record<string, unknown>;
      expect(consentPayload.subjek_ref).toBe('new-listing-id');
      expect(consentPayload.disetujui).toBe(true);
      expect(consentPayload.versi_kebijakan).toBe('1.0');
    });
  });
});
