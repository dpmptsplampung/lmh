// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));
vi.mock('@/lib/storage/r2', async () => {
  const { createClient } = await import('@/lib/supabase/server');
  const { r2DariTiruanSupabase } = await import('@/lib/storage/r2-test-adapter');
  return { ...r2DariTiruanSupabase(createClient as never), listObjects: vi.fn(async () => ({ items: [], nextCursor: null })) };
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
  diproses_pada?: string | null;
}

const mockSupabase = async (
  auth: { user: { id: string } | null; role: string | null },
  opts: {
    doc?: DocRow | null;
    kelola?: boolean;
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
    rpc: vi.fn(async () => ({ data: opts.kelola ?? auth.role === 'admin', error: null })),
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
          delete: vi.fn().mockReturnValue({ eq: (...args: unknown[]) => {
            const query = (deleteEq as (...a: unknown[]) => Record<string, unknown>)(...args);
            query.is = vi.fn().mockReturnValue(query);
            query.eq = vi.fn().mockReturnValue(query);
            return query;
          } }),
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

  it('returns 403 when petugas tidak bermodul investasi', async () => {
    await mockSupabase({ user: { id: 'u-1' }, role: 'petugas' });
    const { DELETE } = await import('./route');
    const res = await DELETE(buildRequest(), paramsOf());
    expect(res.status).toBe(403);
  });

  it('petugas modul investasi boleh menghapus dokumen', async () => {
    await mockSupabase({ user: { id: 'u-1' }, role: 'petugas' }, { kelola: true });
    const { DELETE } = await import('./route');
    expect((await DELETE(buildRequest(), paramsOf())).status).toBe(200);
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

describe('penghapusan dengan fence render dan sapu seluruh prefix', () => {
  beforeEach(() => { vi.resetModules(); });
  it('menolak hapus saat render memegang lease, tanpa menyentuh file', async () => {
    const mock = await mockSupabase({ user: { id: 'u-1' }, role: 'admin' }, { doc: {
      id: DOC_ID, file_path: `src/${DOC_ID}.pdf`, halaman_gambar: [], diproses_pada: new Date().toISOString(),
    } });
    const { DELETE } = await import('./route');
    expect((await DELETE(buildRequest(), paramsOf())).status).toBe(409);
    expect(mock._deleteEq).not.toHaveBeenCalled(); expect(mock._remove).not.toHaveBeenCalled();
    // Setelah renderer melepas lease, penghapusan menyapu PNG di luar checkpoint juga.
    mock._selectChain.maybeSingle.mockResolvedValueOnce({ data: {
      id: DOC_ID, file_path: `src/${DOC_ID}.pdf`, halaman_gambar: [], diproses_pada: null,
    }, error: null });
    const { listObjects } = await import('@/lib/storage/r2');
    vi.mocked(listObjects).mockResolvedValueOnce({ items: [{ key: `investment-docs/pages/${DOC_ID}/orphan.png`, lastModified: new Date() }], nextCursor: null });
    expect((await DELETE(buildRequest(), paramsOf())).status).toBe(200);
    expect(mock._remove.mock.calls.flatMap(c => c[0])).toContain(`pages/${DOC_ID}/orphan.png`);
  });
  it('menghapus PNG tak tercatat di semua halaman listing setelah lease dilepas', async () => {
    const mock = await mockSupabase({ user: { id: 'u-1' }, role: 'admin' }, { doc: {
      id: DOC_ID, file_path: `src/${DOC_ID}.pdf`, halaman_gambar: [], diproses_pada: null,
    } });
    const { listObjects } = await import('@/lib/storage/r2');
    vi.mocked(listObjects).mockResolvedValueOnce({ items: [{ key: `investment-docs/pages/${DOC_ID}/orphan-1.png`, lastModified: new Date() }], nextCursor: 'kedua' })
      .mockResolvedValueOnce({ items: [{ key: `investment-docs/pages/${DOC_ID}/orphan-2.png`, lastModified: new Date() }], nextCursor: null });
    const { DELETE } = await import('./route');
    expect((await DELETE(buildRequest(), paramsOf())).status).toBe(200);
    expect(mock._remove.mock.calls.flatMap(c => c[0])).toEqual([`src/${DOC_ID}.pdf`, `pages/${DOC_ID}/orphan-1.png`, `pages/${DOC_ID}/orphan-2.png`]);
    expect(listObjects).toHaveBeenLastCalledWith('private', `investment-docs/pages/${DOC_ID}/`, 'kedua');
    expect(mock._deleteEq.mock.results[0].value.is).toHaveBeenCalledWith('diproses_pada', null);
  });
  it('lease yang diklaim sesudah SELECT mencegah DELETE dan pembersihan', async () => {
    const mock = await mockSupabase({ user: { id: 'u-1' }, role: 'admin' }, { deleteRows: [] });
    const { DELETE } = await import('./route');
    expect((await DELETE(buildRequest(), paramsOf())).status).toBe(500);
    expect(mock._deleteEq.mock.results[0].value.is).toHaveBeenCalledWith('diproses_pada', null);
    expect(mock._remove).not.toHaveBeenCalled();
  });
});

describe('lease basi dan path asing', () => {
  beforeEach(() => { vi.resetModules(); });
  it('lease basi (render mati karena timeout) tidak mengunci hapus selamanya; DELETE ber-CAS pada lease itu', async () => {
    const basi = new Date(Date.now() - 120_000).toISOString();
    const mock = await mockSupabase({ user: { id: 'u-1' }, role: 'admin' }, { doc: {
      id: DOC_ID, file_path: `src/${DOC_ID}.pdf`, halaman_gambar: [], diproses_pada: basi,
    } });
    const { DELETE } = await import('./route');
    expect((await DELETE(buildRequest(), paramsOf())).status).toBe(200);
    const query = mock._deleteEq.mock.results[0].value;
    expect(query.eq).toHaveBeenCalledWith('diproses_pada', basi);
    expect(query.is).not.toHaveBeenCalled();
  });
  it('lease basi yang diklaim ulang render sebelum DELETE: 0 baris, storage tidak disentuh', async () => {
    const mock = await mockSupabase({ user: { id: 'u-1' }, role: 'admin' }, { deleteRows: [], doc: {
      id: DOC_ID, file_path: `src/${DOC_ID}.pdf`, halaman_gambar: [], diproses_pada: new Date(Date.now() - 120_000).toISOString(),
    } });
    const { DELETE } = await import('./route');
    expect((await DELETE(buildRequest(), paramsOf())).status).toBe(500);
    expect(mock._remove).not.toHaveBeenCalled();
  });
  it('path dari baris yang diubah lewat PostgREST tidak dapat menghapus objek dokumen lain atau raw', async () => {
    const LAIN = '22222222-2222-2222-2222-222222222222';
    const UID = '33333333-3333-3333-3333-333333333333';
    const mock = await mockSupabase({ user: { id: 'u-1' }, role: 'admin' }, { doc: {
      id: DOC_ID, file_path: `src/${LAIN}.pdf`, diproses_pada: null,
      halaman_gambar: [`pages/${LAIN}/b/page-1.png`, `raw/${UID}/${LAIN}.pdf`, `_raw/${LAIN}.pdf`, `pages/${DOC_ID}/b/page-2.png`],
    } });
    const { DELETE } = await import('./route');
    expect((await DELETE(buildRequest(), paramsOf())).status).toBe(200);
    expect(mock._remove.mock.calls.flatMap(c => c[0])).toEqual([`pages/${DOC_ID}/b/page-2.png`]);
  });
});


it('DELETE sukses menginvalidasi tag investasi', async () => {
  const { revalidateTag } = await import('next/cache');
  vi.mocked(revalidateTag).mockClear();
  await mockSupabase({ user: { id: 'admin' }, role: 'admin' });
  const { DELETE } = await import('./route');
  expect((await DELETE(buildRequest(), paramsOf())).status).toBe(200);
  expect(revalidateTag).toHaveBeenCalledExactlyOnceWith('publik-investasi', { expire: 0 });
});

describe('PATCH katalog dokumen', () => {
  const tetangga = '22222222-2222-4222-8222-222222222222';
  const id = '11111111-1111-4111-8111-111111111111';
  const payloadStatus = { aksi: 'status', status: 'nonaktif', status_lama: 'aktif' };
  const payloadUrutan = { aksi: 'urutan', tetangga_id: tetangga, urutan_lama: 1, urutan_tetangga: 2 };
  const payloadMetadata = { aksi: 'metadata', judul: 'Dokumen baru', kategori: 'peta-potensi',
    deskripsi: null, nilai_investasi: 'USD 10', image_url: null };
  const patch = (input: object) => new Request(`http://localhost/api/investment-docs/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  const pasang = async (opsi: { boleh?: boolean; kosong?: boolean; konflik?: boolean } = {}) => {
    const { createClient } = await import('@/lib/supabase/server');
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: opsi.kosong ? null : { id }, error: null }),
    });
    const rpc = vi.fn(async (nama: string) => nama === 'boleh_kelola_investasi'
      ? { data: opsi.boleh ?? true, error: null }
      : { data: null, error: opsi.konflik ? { code: '40001', message: 'KONFLIK_VERSI' } : null });
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id } }, error: null }) },
      from: vi.fn(() => ({ update })), rpc,
    } as unknown as Awaited<ReturnType<typeof createClient>>);
    return { update, rpc };
  };

  beforeEach(() => vi.clearAllMocks());

  it.each([payloadStatus, payloadMetadata, payloadUrutan])('invalidasi satu kali sesudah mutasi $aksi', async input => {
    const t = await pasang();
    const { PATCH } = await import('./route');
    const { revalidateTag } = await import('next/cache');
    const respons = await PATCH(patch(input), paramsOf(id));
    expect(respons.status).toBe(200);
    expect(await respons.json()).toEqual({ data: { id } });
    expect(revalidateTag).toHaveBeenCalledExactlyOnceWith('publik-investasi', { expire: 0 });
    if (input.aksi === 'urutan') {
      expect(t.update).not.toHaveBeenCalled();
      expect(t.rpc).toHaveBeenLastCalledWith('investasi_tukar_urutan_dokumen', {
        p_id: id, p_tetangga_id: tetangga, p_urutan_lama: 1, p_urutan_tetangga: 2,
      });
    } else {
      expect(t.update).toHaveBeenCalledTimes(1);
      expect(t.update.mock.calls[0][0]).not.toHaveProperty('aksi');
      expect(t.update.mock.calls[0][0]).not.toHaveProperty('status_lama');
      if (input.aksi === 'metadata') expect(t.update.mock.calls[0][0]).toMatchObject({ kategori: 'Peta Potensi' });
    }
  });

  it.each([[payloadUrutan, { konflik: true }, 409], [payloadStatus, { kosong: true }, 409],
    [payloadMetadata, { boleh: false }, 403], [{ ...payloadStatus, status: 'diproses' }, {}, 400]] as const)(
    'menolak mutasi %o dengan status %s tanpa invalidasi', async (input, opsi, status) => {
      await pasang(opsi);
      const { PATCH } = await import('./route');
      const { revalidateTag } = await import('next/cache');
      expect((await PATCH(patch(input), paramsOf(id))).status).toBe(status);
      expect(revalidateTag).not.toHaveBeenCalled();
    },
  );
});
