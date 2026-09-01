// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@/components/admin/RekapLayananTable', () => ({
  default: ({ isPetugas, initialLayananId }: { isPetugas: boolean; initialLayananId: string | null }) => (
    <div data-testid="rekap-table">{`isPetugas=${isPetugas};layananId=${initialLayananId ?? 'null'}`}</div>
  ),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

type Thenable = PromiseLike<{ data: unknown[]; error: null }> & Record<string, unknown>;
type Builder = Thenable & {
  from: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  lte: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  ilike: ReturnType<typeof vi.fn>;
  or: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  auth: { getUser: ReturnType<typeof vi.fn> };
};

// Permissive thenable mock: any chain of builder methods resolves with empty data.
// The page calls different chains for each tab; the active 'umum' tab issues a chain
// with two `.order()` calls, so we accept any builder method and treat the builder
// itself as a thenable returning `{ data: [], error: null }`.
vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => {
    const result = { data: [] as unknown[], error: null };
    const builder: Builder = {
      then: (onFulfilled: (v: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve(result).then(onFulfilled),
    } as unknown as Builder;
    for (const m of [
      'from',
      'select',
      'eq',
      'gte',
      'lte',
      'order',
      'range',
      'limit',
      'in',
      'ilike',
      'or',
      'maybeSingle',
      'single',
      'rpc',
      'insert',
      'update',
      'delete',
    ] as const) {
      builder[m] = vi.fn(() => builder);
    }
    builder.auth = {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null }),
    };
    return builder;
  }),
}));

vi.mock('@/components/layout/PageHeader', () => ({
  default: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

// Mock the page's `fetch('/api/admin/rekap/layanan-options')` call on mount.
const mockFetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: async () => ({ options: [], default_layanan_id: null, is_petugas: false }),
  })
);
global.fetch = mockFetch as unknown as typeof fetch;

import AdminRekapPage from './page';

describe('Admin rekap page - new tab', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders all 4 tab buttons', async () => {
    render(<AdminRekapPage />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole('button', { name: /rekap umum harian/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pendataan helpdesk oss/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pendataan perizinan dpmptsp/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /rekap per layanan/i })).toBeInTheDocument();
  });
});
