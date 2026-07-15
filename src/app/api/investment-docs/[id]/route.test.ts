// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import type { NextRequest } from 'next/server';

const DOC_ID = '11111111-1111-1111-1111-111111111111';

const buildRequest = (id = DOC_ID): NextRequest => {
  const req = new Request(`http://localhost/api/investment-docs/${id}`, {
    method: 'DELETE',
  });
  (req as unknown as { nextUrl: URL }).nextUrl = new URL(
    `http://localhost/api/investment-docs/${id}`,
  );
  return req as unknown as NextRequest;
};

const paramsOf = (id = DOC_ID) => ({ params: Promise.resolve({ id }) });

interface DocRow {
  id: string;
  file_path: string | null;
  halaman_gambar: string[] | null;
}

const mockSupabase = async (
  auth: { user: { id: string } | null; role: string | null },
  opts: {
    doc?: DocRow | null;
    deleteError?: unknown;
    removeError?: unknown;
    removeSpy?: ReturnType<typeof vi.fn>;
    deleteSpy?: ReturnType<typeof vi.fn>;
  } = {},
) => {
  const serverMod = await import('@/lib/supabase/server');
  const createClient = serverMod.createClient as unknown as ReturnType<typeof vi.fn>;

  const remove =
    opts.removeSpy ??
    vi.fn().mockResolvedValue({ data: null, error: opts.removeError ?? null });
  const deleteEq =
    opts.deleteSpy ??
    vi.fn().mockResolvedValue({ error: opts.deleteError ?? null });

  const selectChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: opts.doc === undefined
        ? {
            id: DOC_ID,
            file_path: `_raw/${DOC_ID}.pdf`,
            halaman_gambar: [`pages/${DOC_ID}/page-1.png`, `pages/${DOC_ID}/page-2.png`],
          }
        : opts.doc,
      error: null,
    }),
  };

  const petugasChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: auth.user ? { role: auth.role } : null,
      error: null,
    }),
  };

  const mock = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: auth.user }, error: null }),
    },
    from: vi.fn((table: string) => {
      if (table === 'petugas') return petugasChain;
      if (table === 'investment_documents') {
        return {
          select: selectChain.select,
          eq: selectChain.eq,
          maybeSingle: selectChain.maybeSingle,
          delete: vi.fn().mockReturnValue({ eq: deleteEq }),
        };
      }
      return {};
    }),
    storage: {
      from: vi.fn().mockReturnValue({ remove }),
    },
    _remove: remove,
    _deleteEq: deleteEq,
    _selectChain: selectChain,
  };

  // Wire select().eq().maybeSingle for doc load
  selectChain.select.mockReturnValue(selectChain);
  selectChain.eq.mockImplementation(() => selectChain);

  createClient.mockResolvedValue(mock);
  return mock;
};

describe('DELETE /api/investment-docs/[id] — auth', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns 401 when unauthenticated', async () => {
    await mockSupabase({ user: null, role: null });
    const { DELETE } = await import('./route');
    const res = await DELETE(buildRequest(), paramsOf());
    expect(res.status).toBe(401);
  });

  it('returns 403 when user is petugas (not admin)', async () => {
    await mockSupabase({ user: { id: 'u-1' }, role: 'petugas' });
    const { DELETE } = await import('./route');
    const res = await DELETE(buildRequest(), paramsOf());
    expect(res.status).toBe(403);
  });

  it('returns 403 when user has no petugas row', async () => {
    await mockSupabase({ user: { id: 'u-1' }, role: null });
    const { DELETE } = await import('./route');
    const res = await DELETE(buildRequest(), paramsOf());
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/investment-docs/[id] — happy path + 404', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns 404 when document is missing', async () => {
    await mockSupabase({ user: { id: 'u-1' }, role: 'admin' }, { doc: null });
    const { DELETE } = await import('./route');
    const res = await DELETE(buildRequest(), paramsOf());
    expect(res.status).toBe(404);
  });

  it('removes storage paths then deletes DB row and returns 200', async () => {
    const remove = vi.fn().mockResolvedValue({ data: null, error: null });
    const deleteEq = vi.fn().mockResolvedValue({ error: null });
    const doc: DocRow = {
      id: DOC_ID,
      file_path: `_raw/${DOC_ID}.pdf`,
      halaman_gambar: [`pages/${DOC_ID}/page-1.png`, `pages/${DOC_ID}/page-2.png`],
    };
    await mockSupabase(
      { user: { id: 'u-1' }, role: 'admin' },
      { doc, removeSpy: remove, deleteSpy: deleteEq },
    );
    const { DELETE } = await import('./route');
    const res = await DELETE(buildRequest(), paramsOf());
    expect(res.status).toBe(200);

    expect(remove).toHaveBeenCalled();
    const removed = remove.mock.calls.flatMap((c) => c[0] as string[]);
    expect(removed).toEqual(
      expect.arrayContaining([
        `_raw/${DOC_ID}.pdf`,
        `pages/${DOC_ID}/page-1.png`,
        `pages/${DOC_ID}/page-2.png`,
      ]),
    );
    expect(deleteEq).toHaveBeenCalledWith('id', DOC_ID);
  });

  it('still attempts DB delete after storage remove; returns 500 if DB fails', async () => {
    const remove = vi.fn().mockResolvedValue({ data: null, error: null });
    const deleteEq = vi.fn().mockResolvedValue({ error: { message: 'db fail' } });
    await mockSupabase(
      { user: { id: 'u-1' }, role: 'admin' },
      {
        doc: {
          id: DOC_ID,
          file_path: `_raw/${DOC_ID}.pdf`,
          halaman_gambar: [`pages/${DOC_ID}/page-1.png`],
        },
        removeSpy: remove,
        deleteSpy: deleteEq,
      },
    );
    const { DELETE } = await import('./route');
    const res = await DELETE(buildRequest(), paramsOf());
    expect(res.status).toBe(500);
    expect(remove).toHaveBeenCalled();
    expect(deleteEq).toHaveBeenCalled();
    const json = await res.json();
    expect(json.error).toMatch(/delete|db|storage/i);
  });
});
