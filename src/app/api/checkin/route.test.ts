// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

const buildRequest = (body: unknown): NextRequest => {
  const req = new Request('http://localhost/api/checkin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return req as unknown as NextRequest;
};

describe('POST /api/checkin consent assertion', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('rejects authenticated check-in without consent_given and does not write consent_log', async () => {
    const serverMod = await import('@/lib/supabase/server');
    const createClient = serverMod.createClient as unknown as ReturnType<typeof vi.fn>;

    const consentInsert = vi.fn();
    const visitInsert = vi.fn();

    createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
      },
      from: vi.fn((table: string) => {
        if (table === 'consent_log') {
          return { insert: consentInsert };
        }
        if (table === 'visit') {
          return {
            insert: visitInsert.mockReturnValue({
              select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'v1' }, error: null }),
              }),
            }),
          };
        }
        return {};
      }),
    });

    const { POST } = await import('./route');
    const res = await POST(
      buildRequest({
        nama: 'Budi',
        layanan_id: '11111111-1111-4111-8111-111111111111',
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/consent/i);
    expect(consentInsert).not.toHaveBeenCalled();
    expect(visitInsert).not.toHaveBeenCalled();
  });

  it('writes consent_log only when consent_given is true', async () => {
    const serverMod = await import('@/lib/supabase/server');
    const createClient = serverMod.createClient as unknown as ReturnType<typeof vi.fn>;

    const consentInsert = vi.fn().mockResolvedValue({ error: null });
    const visitInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'v1' }, error: null }),
      }),
    });

    createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
      },
      from: vi.fn((table: string) => {
        if (table === 'pengunjung') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'pengunjung-1' }, error: null }),
          };
        }
        if (table === 'consent_log') return { insert: consentInsert };
        if (table === 'visit') return { insert: visitInsert };
        return {};
      }),
    });

    const { POST } = await import('./route');
    const res = await POST(
      buildRequest({
        nama: 'Budi',
        layanan_id: '11111111-1111-4111-8111-111111111111',
        consent_given: true,
        versi_kebijakan: '1.0',
      }),
    );

    expect(res.status).toBe(201);
    expect(consentInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        subjek_ref: 'user-1',
        disetujui: true,
        versi_kebijakan: '1.0',
      }),
    );
    expect(visitInsert).toHaveBeenCalledWith(
      expect.objectContaining({ pengunjung_id: 'pengunjung-1' }),
    );
  });

  it('does not bind pengunjung_id when caller has no profile row', async () => {
    const serverMod = await import('@/lib/supabase/server');
    const createClient = serverMod.createClient as unknown as ReturnType<typeof vi.fn>;

    const consentInsert = vi.fn().mockResolvedValue({ error: null });
    const visitInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'v2' }, error: null }),
      }),
    });

    createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-2' } }, error: null }),
      },
      from: vi.fn((table: string) => {
        if (table === 'pengunjung') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        if (table === 'consent_log') return { insert: consentInsert };
        if (table === 'visit') return { insert: visitInsert };
        return {};
      }),
    });

    const { POST } = await import('./route');
    const res = await POST(
      buildRequest({
        nama: 'Ani',
        layanan_id: '11111111-1111-4111-8111-111111111111',
        consent_given: true,
      }),
    );

    expect(res.status).toBe(201);
    expect(visitInsert).toHaveBeenCalledWith(
      expect.not.objectContaining({ pengunjung_id: expect.anything() }),
    );
  });
});

// Audit T2d (No 88-89): kedua INSERT dibungkus mutasiInsert. Kontrak respons tidak berubah (CONSENT_FAILED 500,
// duplikat idempoten 200, LAYANAN_TUTUP 409, gagal umum 500); tambahan: INSERT yang tak mengembalikan baris
// (mis. trigger BEFORE INSERT membatalkan baris) tak lagi dilaporkan 201 tanpa id -- replay offline akan membuang antrean.
describe('POST /api/checkin — mutasi tercek (audit T2d)', () => {
  const LAYANAN = '11111111-1111-4111-8111-111111111111';
  const CLIENT_REQ = '22222222-2222-4222-8222-222222222222';
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  const log = (op: string) =>
    errSpy.mock.calls
      .map((c: unknown[]) => { try { return JSON.parse(String(c[0])) as Record<string, unknown>; } catch { return null; } })
      .find((e: Record<string, unknown> | null) => e?.operation === op);

  interface Opts {
    user?: boolean;
    consentError?: { message: string; code?: string; details?: string } | null;
    visit?: { data: { id: string } | null; error: { message: string; code?: string; details?: string } | null };
    existing?: { id: string } | null;
  }

  async function setup(o: Opts = {}) {
    const serverMod = await import('@/lib/supabase/server');
    const createClient = serverMod.createClient as unknown as ReturnType<typeof vi.fn>;
    const consentInsert = vi.fn().mockResolvedValue({ error: o.consentError ?? null });
    const visitInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue(o.visit ?? { data: { id: 'v1' }, error: null }),
      }),
    });
    createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: o.user === false ? null : { id: 'user-1' } }, error: null }),
      },
      from: vi.fn((table: string) => {
        if (table === 'pengunjung') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'pengunjung-1' }, error: null }),
          };
        }
        if (table === 'consent_log') return { insert: consentInsert };
        if (table === 'visit') {
          return {
            insert: visitInsert,
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: o.existing ?? null, error: null }),
          };
        }
        return {};
      }),
    });
    return { consentInsert, visitInsert };
  }

  const body = (extra: Record<string, unknown> = {}) =>
    buildRequest({ nama: 'Budi', layanan_id: LAYANAN, consent_given: true, ...extra });

  it('consent_log gagal: 500 CONSENT_FAILED, visit tidak ditulis, dicatat dengan kode tanpa pesan teknis', async () => {
    const s = await setup({ consentError: { message: 'connection reset secret-xyz', code: '08006' } });
    const { POST } = await import('./route');
    const res = await POST(body());

    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('CONSENT_FAILED');
    expect(s.visitInsert).not.toHaveBeenCalled();
    const l = log('checkin.consent_insert');
    expect(l).toMatchObject({ kode: 'database', asalCode: '08006' });
    expect(JSON.stringify(l)).not.toContain('secret-xyz');
  });

  it('visit gagal (umum): 500 dengan pesan baku, dicatat dengan kode tanpa pesan teknis', async () => {
    await setup({ visit: { data: null, error: { message: 'deadlock detected secret-xyz', code: '40P01' } } });
    const { POST } = await import('./route');
    const res = await POST(body());

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Gagal menyimpan. Silakan coba lagi.');
    expect(JSON.stringify(json)).not.toContain('secret-xyz');
    const l = log('checkin.visit_insert');
    expect(l).toMatchObject({ kode: 'database', asalCode: '40P01' });
    expect(JSON.stringify(l)).not.toContain('secret-xyz');
  });

  it('visit duplikat (23505) dengan client_request_id: 200 idempoten dengan id kunjungan yang sudah ada, tanpa dicatat sebagai error', async () => {
    await setup({
      visit: { data: null, error: { message: 'duplicate key', code: '23505' } },
      existing: { id: 'v-lama' },
    });
    const { POST } = await import('./route');
    const res = await POST(body({ client_request_id: CLIENT_REQ }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 'v-lama', duplicate: true });
    expect(log('checkin.visit_insert')).toBeUndefined();
  });

  it('layanan tutup (details LAYANAN_TUTUP): 409 dengan kode dan pesan ramah dari trigger', async () => {
    await setup({
      visit: { data: null, error: { message: 'Layanan sudah tutup, kembali besok pukul 08.00', code: 'P0001', details: 'LAYANAN_TUTUP' } },
    });
    const { POST } = await import('./route');
    const res = await POST(body());

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Layanan sudah tutup, kembali besok pukul 08.00', code: 'LAYANAN_TUTUP' });
    expect(log('checkin.visit_insert')).toBeUndefined();
  });

  it('visit tanpa error tetapi 0 baris (tidak ada yang tertulis): 500, BUKAN 201 tanpa id; dicatat tidak_ada_baris', async () => {
    await setup({ visit: { data: null, error: null } });
    const { POST } = await import('./route');
    const res = await POST(body());

    expect(res.status).toBe(500);
    expect(log('checkin.visit_insert')).toMatchObject({ kode: 'tidak_ada_baris' });
  });

  it('berhasil: 201 dengan id (tidak berubah)', async () => {
    await setup();
    const { POST } = await import('./route');
    const res = await POST(body());

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'v1', message: 'Check-in berhasil' });
  });
});
