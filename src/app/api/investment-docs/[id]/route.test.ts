// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));
vi.mock('@/lib/storage/r2', async () => {
  const { createClient } = await import('@/lib/supabase/server');
  const { r2DariTiruanSupabase } = await import('@/lib/storage/r2-test-adapter');
  return r2DariTiruanSupabase(createClient as never);
});

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
    // Baris yang dikembalikan DELETE ... .select('id'); [] = 0 baris tanpa error (RLS menolak / sudah hilang).
    deleteRows?: unknown[];
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
  const deleteSelect = vi.fn().mockResolvedValue({
    data: opts.deleteError ? null : (opts.deleteRows ?? [{ id: DOC_ID }]),
    error: opts.deleteError ?? null,
  });
  const deleteEq = opts.deleteSpy ?? vi.fn().mockReturnValue({ select: deleteSelect });

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

  it('deletes the DB row FIRST, then removes storage paths, and returns 200', async () => {
    const urutan: string[] = [];
    const remove = vi.fn().mockImplementation(async () => { urutan.push('storage'); return { data: null, error: null }; });
    const deleteEq = vi.fn().mockImplementation(() => ({
      select: vi.fn().mockImplementation(async () => { urutan.push('db'); return { data: [{ id: DOC_ID }], error: null }; }),
    }));
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
    // Baris yatim tanpa file lebih berbahaya daripada file yatim tanpa baris: baris dihapus lebih dulu.
    expect(urutan).toEqual(['db', 'storage']);
  });

  it('DB delete fails: returns 500 and storage is NOT touched (file tetap utuh, dokumen tetap konsisten)', async () => {
    const remove = vi.fn().mockResolvedValue({ data: null, error: null });
    const deleteEq = vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: null, error: { message: 'db fail' } }) });
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
    expect(remove).not.toHaveBeenCalled();
    expect(deleteEq).toHaveBeenCalled();
    const json = await res.json();
    expect(json.error).toMatch(/gagal menghapus/i);
  });
});

// Audit T2d (No 100): DELETE yang ditolak RLS / baris sudah hilang = 0 baris TANPA error. Storage sudah terhapus lebih
// dulu, jadi melapor 200 {ok:true} di sini menyembunyikan dokumen yang masih ada di DB tetapi file-nya sudah hilang.
describe('DELETE /api/investment-docs/[id] — hasil DELETE DB dicek (audit T2d)', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    errSpy.mockRestore();
    warnSpy.mockRestore();
    vi.unstubAllGlobals();
  });
  const log = () =>
    errSpy.mock.calls
      .map((c: unknown[]) => { try { return JSON.parse(String(c[0])) as Record<string, unknown>; } catch { return null; } })
      .find((e: Record<string, unknown> | null) => e?.operation === 'investment_docs.delete');

  it('DELETE 0 baris tanpa error: 500 dengan bentuk error yang sama (bukan 200 ok), dicatat tidak_ada_baris', async () => {
    const removeSpy = vi.fn().mockResolvedValue({ data: null, error: null });
    await mockSupabase({ user: { id: 'u-1' }, role: 'admin' }, { deleteRows: [], removeSpy });
    const { DELETE } = await import('./route');
    const res = await DELETE(buildRequest(), paramsOf());

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/gagal menghapus/i);
    expect(log()).toMatchObject({ kode: 'tidak_ada_baris', docId: DOC_ID });
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('DELETE error: 500; detail ke klien = pesan aman (bukan teks error database mentah); dicatat dengan kode', async () => {
    await mockSupabase(
      { user: { id: 'u-1' }, role: 'admin' },
      { deleteError: { message: 'update or delete violates foreign key "inv_lead_fk" secret-xyz', code: '23503' } },
    );
    const { DELETE } = await import('./route');
    const res = await DELETE(buildRequest(), paramsOf());

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(JSON.stringify(json)).not.toContain('secret-xyz');
    expect(JSON.stringify(json)).not.toContain('inv_lead_fk');
    expect(log()).toMatchObject({ kode: 'database', asalCode: '23503' });
  });

  it('berhasil: 200 {ok,id} tidak berubah dan DELETE memakai .select untuk membuktikan baris terdampak', async () => {
    const select = vi.fn().mockResolvedValue({ data: [{ id: DOC_ID }], error: null });
    const deleteEq = vi.fn().mockReturnValue({ select });
    await mockSupabase({ user: { id: 'u-1' }, role: 'admin' }, { deleteSpy: deleteEq });
    const { DELETE } = await import('./route');
    const res = await DELETE(buildRequest(), paramsOf());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: DOC_ID });
    expect(select).toHaveBeenCalledWith('id');
  });

  it('storage gagal SETELAH baris terhapus: tetap 200 (file yatim lebih aman daripada baris yatim), tetapi dicatat', async () => {
    await mockSupabase({ user: { id: 'u-1' }, role: 'admin' }, { removeError: { message: 'storage down secret-xyz' } });
    const { DELETE } = await import('./route');
    const res = await DELETE(buildRequest(), paramsOf());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: DOC_ID });
    const l = errSpy.mock.calls
      .concat(warnSpy.mock.calls)
      .map((c: unknown[]) => { try { return JSON.parse(String(c[0])) as Record<string, unknown>; } catch { return null; } })
      .find((e: Record<string, unknown> | null) => e?.operation === 'investment_docs.delete.storage');
    expect(l).toMatchObject({ docId: DOC_ID, nFile: 3 });
    expect(JSON.stringify(l)).not.toContain('secret-xyz');
  });

  it('storage melempar SETELAH baris terhapus: tetap 200 dan dicatat', async () => {
    const removeSpy = vi.fn().mockRejectedValue(new Error('jaringan putus'));
    await mockSupabase({ user: { id: 'u-1' }, role: 'admin' }, { removeSpy });
    const { DELETE } = await import('./route');
    const res = await DELETE(buildRequest(), paramsOf());

    expect(res.status).toBe(200);
    const l = errSpy.mock.calls
      .concat(warnSpy.mock.calls)
      .map((c: unknown[]) => { try { return JSON.parse(String(c[0])) as Record<string, unknown>; } catch { return null; } })
      .find((e: Record<string, unknown> | null) => e?.operation === 'investment_docs.delete.storage');
    expect(l).toBeTruthy();
  });
});
