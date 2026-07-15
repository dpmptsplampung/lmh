// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
const mockSearchParams = vi.fn();
vi.mock('next/navigation', () => ({ useSearchParams: () => mockSearchParams() }));

import { createClient } from '@/lib/supabase/client';
import SkmPage from './page';

type Context = {
  eligible: boolean;
  already_submitted: boolean;
  layanan_nama: string | null;
} | null;

function setup(context: Context, token: string | null = 'opaque-token') {
  const maybeSingle = vi.fn().mockResolvedValue({ data: context, error: null });
  const rpc = vi.fn().mockReturnValue({ maybeSingle });
  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ rpc });
  mockSearchParams.mockReturnValue({ get: () => token });
  return { rpc, maybeSingle };
}

describe('public SKM token lookup', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('uses the anonymous-safe get_skm_context RPC and receives no visit IDs or PII', async () => {
    const context = { eligible: true, already_submitted: false, layanan_nama: 'Helpdesk OSS' };
    const { rpc } = setup(context);
    render(<SkmPage />);

    await screen.findByText('U1 Persyaratan');
    expect(rpc).toHaveBeenCalledWith('get_skm_context', { p_token: 'opaque-token' });
    expect(context).not.toHaveProperty('visit_id');
    expect(context).not.toHaveProperty('layanan_id');
    expect(context).not.toHaveProperty('nama');
    expect(context).not.toHaveProperty('email');
  });

  it('shows unavailable for unfinished visits', async () => {
    setup({ eligible: false, already_submitted: false, layanan_nama: 'Helpdesk OSS' });
    render(<SkmPage />);
    expect(await screen.findByText('Survei Belum Tersedia')).toBeInTheDocument();
  });

  it('shows already submitted from trusted context', async () => {
    setup({ eligible: true, already_submitted: true, layanan_nama: 'Helpdesk OSS' });
    render(<SkmPage />);
    expect(await screen.findByText(/sudah mengisi survei ini/i)).toBeInTheDocument();
  });

  it('shows invalid token when the RPC returns no row', async () => {
    setup(null);
    render(<SkmPage />);
    await waitFor(() => expect(screen.getByText('Token Tidak Valid')).toBeInTheDocument());
  });
});
