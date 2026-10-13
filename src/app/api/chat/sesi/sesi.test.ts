import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const serverState = { callerId: 'auth-staff-1' as string | null };

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: serverState.callerId ? { id: serverState.callerId } : null },
        error: null,
      })),
    },
  })),
}));

const mockAdmin = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockAdmin()),
}));

const SESI = '3f2504e0-4f89-41d3-8a0c-0305e82c3301';

function buildReq(body: unknown) {
  return new NextRequest('http://localhost/api/chat/sesi', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

interface MakeClientOpts {
  actor: Record<string, unknown> | null;
  sesiStatus?: string;
  role?: string;
  ditangani?: string | null;
  raceLost?: boolean;
  updateVals?: unknown[];
  // Kondisi bersyarat UPDATE (.eq/.is/.filter) yang dicatat mock: [metode, kolom, nilai]
  conds?: unknown[][];
  // Mutasi (audit T2d)
  updateError?: { message: string; code?: string };
  auditError?: { message: string; code?: string };
  pesanError?: { message: string; code?: string };
}

function makeClient(opts: MakeClientOpts) {
  const auditInsert = vi.fn(async () => ({ error: opts.auditError ?? null }));
  const chatPesanInsert = vi.fn(async () => ({ error: opts.pesanError ?? null }));
  const client = {
    auditInsert,
    chatPesanInsert,
    from: (t: string) => {
      if (t === 'petugas') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: opts.actor?.kind === 'staff' ? { id: 'st-1', nama: 'Budi', role: opts.role ?? 'admin', layanan_id: opts.role === 'petugas' ? 'ly-1' : null } : null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (t === 'pengunjung') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      if (t === 'chat_sesi') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: SESI, status: opts.sesiStatus ?? 'eskalasi', pengunjung_id: 'pg-1', layanan_id: 'ly-1', ditangani_oleh: opts.ditangani ?? null },
                error: null,
              }),
            }),
          }),
          update: (vals: unknown) => {
            opts.updateVals?.push(vals);
            const b: Record<string, unknown> = {};
            b.eq = (col: string, val: unknown) => { opts.conds?.push(['eq', col, val]); return b; };
            b.is = (col: string, val: unknown) => { opts.conds?.push(['is', col, val]); return b; };
            // .filter(kolom, operator, nilai): operator 'eq'/'is' sama dengan .eq()/.is() (PostgREST: op.nilai)
            b.filter = (col: string, op: string, val: unknown) => { opts.conds?.push([op, col, val]); return b; };
            b.select = async () =>
              opts.updateError
                ? { data: null, error: opts.updateError }
                : { data: opts.raceLost ? [] : [{ id: SESI }], error: null };
            return b;
          },
        };
      }
      if (t === 'chat_pesan') {
        return { insert: chatPesanInsert };
      }
      if (t === 'audit_log') {
        return { insert: auditInsert };
      }
      return {};
    },
  };
  return client;
}

describe('POST /api/chat/sesi', () => {
  beforeEach(() => {
    vi.resetModules();
    serverState.callerId = 'auth-staff-1';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  });

  it('menolak tanpa login dengan 401', async () => {
    serverState.callerId = null;
    mockAdmin.mockReturnValue(makeClient({ actor: null }));
    const { POST } = await import('./route');
    const res = await POST(buildReq({ sesi_id: SESI, aksi: 'takeover' }));
    expect(res.status).toBe(401);
  });

  it('menolak pengunjung (bukan staf) dengan 403', async () => {
    mockAdmin.mockReturnValue(makeClient({
      actor: { kind: 'pengunjung', id: 'pg-1' },
    }));
    const { POST } = await import('./route');
    const res = await POST(buildReq({ sesi_id: SESI, aksi: 'takeover' }));
    expect(res.status).toBe(403);
  });

  it('staf ambil alih: status aktif + pesan sistem + audit', async () => {
    const client = makeClient({
      actor: { kind: 'staff', role: 'admin', layananId: null, id: 'st-1' },
    });
    mockAdmin.mockReturnValue(client);
    const { POST } = await import('./route');
    const res = await POST(buildReq({ sesi_id: SESI, aksi: 'takeover' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('aktif');
    expect(client.chatPesanInsert).toHaveBeenCalledWith(expect.objectContaining({
      pengirim: 'bot',
      sesi_id: SESI,
    }));
    expect(client.auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      aksi: 'chat_sesi_takeover',
    }));
  });

  it('menolak sesi yang sudah selesai dengan 409', async () => {
    mockAdmin.mockReturnValue(makeClient({
      actor: { kind: 'staff', role: 'admin', layananId: null, id: 'st-1' },
      sesiStatus: 'selesai',
    }));
    const { POST } = await import('./route');
    const res = await POST(buildReq({ sesi_id: SESI, aksi: 'takeover' }));
    expect(res.status).toBe(409);
  });

  const staff = { kind: 'staff', role: 'petugas', layananId: 'ly-1', id: 'st-1' };

  it('petugas tidak boleh merebut sesi aktif petugas lain (409 + pemegang)', async () => {
    const client = makeClient({ actor: staff, role: 'petugas', sesiStatus: 'aktif', ditangani: 'st-2' });
    mockAdmin.mockReturnValue(client);
    const { POST } = await import('./route');
    const res = await POST(buildReq({ sesi_id: SESI, aksi: 'takeover' }));
    expect(res.status).toBe(409);
    expect((await res.json()).holder.id).toBe('st-2');
    expect(client.chatPesanInsert).not.toHaveBeenCalled();
  });

  it('admin boleh mengambil alih sesi aktif petugas lain', async () => {
    mockAdmin.mockReturnValue(makeClient({ actor: staff, role: 'admin', sesiStatus: 'aktif', ditangani: 'st-2' }));
    const { POST } = await import('./route');
    const res = await POST(buildReq({ sesi_id: SESI, aksi: 'takeover' }));
    expect(res.status).toBe(200);
  });

  it('takeover berulang oleh pemegang yang sama idempoten (tanpa pesan ganda)', async () => {
    const client = makeClient({ actor: staff, role: 'petugas', sesiStatus: 'aktif', ditangani: 'st-1' });
    mockAdmin.mockReturnValue(client);
    const { POST } = await import('./route');
    const res = await POST(buildReq({ sesi_id: SESI, aksi: 'takeover' }));
    expect(res.status).toBe(200);
    expect((await res.json()).unchanged).toBe(true);
    expect(client.chatPesanInsert).not.toHaveBeenCalled();
  });

  it('update bersyarat kalah balapan -> 409 tanpa pesan sistem', async () => {
    const client = makeClient({ actor: staff, role: 'admin', sesiStatus: 'eskalasi', raceLost: true });
    mockAdmin.mockReturnValue(client);
    const { POST } = await import('./route');
    const res = await POST(buildReq({ sesi_id: SESI, aksi: 'takeover' }));
    expect(res.status).toBe(409);
    expect(client.chatPesanInsert).not.toHaveBeenCalled();
    expect(client.auditInsert).not.toHaveBeenCalled();
  });

  it('petugas biasa tidak boleh menyelesaikan/mengembalikan sesi petugas lain', async () => {
    for (const aksi of ['selesaikan', 'kembali_ke_bot']) {
      mockAdmin.mockReturnValue(makeClient({ actor: staff, role: 'petugas', sesiStatus: 'aktif', ditangani: 'st-2' }));
      vi.resetModules();
      const { POST } = await import('./route');
      const res = await POST(buildReq({ sesi_id: SESI, aksi }));
      expect(res.status).toBe(409);
    }
  });

  // Audit T2d: pesan sistem + audit adalah mutasi SESUDAH status berubah; kegagalannya tak boleh membatalkan aksi
  // (status sudah tersimpan) tetapi harus tercatat dengan kode, bukan ditelan/diabaikan.
  describe('mutasi tercek (audit T2d)', () => {
    // UPDATE bersyarat harus tetap menjaga pemegang sesi (cegah menimpa pemegang lain) walau kini berupa satu rantai
    // yang dibungkus mutasiWajibBaris: pemegang ada -> ditangani_oleh = pemegang; tak ada -> IS NULL.
    it('UPDATE bersyarat: kondisi ditangani_oleh = pemegang bila ada, IS NULL bila tidak', async () => {
      const conds: unknown[][] = [];
      mockAdmin.mockReturnValue(makeClient({
        actor: { kind: 'staff', role: 'admin', layananId: null, id: 'st-1' }, role: 'admin',
        sesiStatus: 'aktif', ditangani: 'st-2', conds,
      }));
      const { POST } = await import('./route');
      expect((await POST(buildReq({ sesi_id: SESI, aksi: 'takeover' }))).status).toBe(200);
      const holderCond = conds.find((c) => c[1] === 'ditangani_oleh');
      expect(holderCond?.[0]).toBe('eq');
      expect(holderCond?.[2]).toBe('st-2');

      vi.resetModules();
      const conds2: unknown[][] = [];
      mockAdmin.mockReturnValue(makeClient({
        actor: { kind: 'staff', role: 'admin', layananId: null, id: 'st-1' }, role: 'admin',
        sesiStatus: 'eskalasi', ditangani: null, conds: conds2,
      }));
      const { POST: POST2 } = await import('./route');
      expect((await POST2(buildReq({ sesi_id: SESI, aksi: 'takeover' }))).status).toBe(200);
      const nullCond = conds2.find((c) => c[1] === 'ditangani_oleh');
      expect(nullCond?.[0]).toBe('is');
      expect(nullCond?.[2]).toBeNull();
    });

    let errSpy: ReturnType<typeof vi.spyOn>;
    let warnSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
      errSpy.mockRestore();
      warnSpy.mockRestore();
    });
    const entri = (...spies: { mock: { calls: unknown[][] } }[]) =>
      spies
        .flatMap((sp) => sp.mock.calls)
        .map((c) => {
          try { return JSON.parse(String(c[0])) as Record<string, unknown>; } catch { return null; }
        })
        .filter((x): x is Record<string, unknown> => x !== null);

    const admin = { actor: { kind: 'staff', role: 'admin', layananId: null, id: 'st-1' }, role: 'admin' };

    it('UPDATE sesi error -> 500 tanpa pesan sistem/audit; dicatat dengan kode (bukan pesan teknis)', async () => {
      const client = makeClient({ ...admin, updateError: { message: 'deadlock detected secret-xyz', code: '40P01' } });
      mockAdmin.mockReturnValue(client);
      const { POST } = await import('./route');
      const res = await POST(buildReq({ sesi_id: SESI, aksi: 'takeover' }));

      expect(res.status).toBe(500);
      expect(client.chatPesanInsert).not.toHaveBeenCalled();
      expect(client.auditInsert).not.toHaveBeenCalled();
      const log = entri(errSpy).find((e) => e.operation === 'chat.sesi.update');
      expect(log).toMatchObject({ kode: 'database', asalCode: '40P01' });
      expect(JSON.stringify(log)).not.toContain('secret-xyz');
    });

    it('audit_log gagal: aksi tetap 200 (status sudah berubah) tetapi kegagalan tercatat', async () => {
      const client = makeClient({ ...admin, auditError: { message: 'x', code: '42501' } });
      mockAdmin.mockReturnValue(client);
      const { POST } = await import('./route');
      const res = await POST(buildReq({ sesi_id: SESI, aksi: 'takeover' }));

      expect(res.status).toBe(200);
      expect((await res.json()).status).toBe('aktif');
      const log = entri(errSpy, warnSpy).find((e) => e.operation === 'chat.sesi.audit_log');
      expect(log).toMatchObject({ kode: 'ditolak', asalCode: '42501' });
    });

    it('pesan sistem gagal: aksi tetap 200 tetapi kegagalan tercatat dan audit tetap ditulis', async () => {
      const client = makeClient({ ...admin, pesanError: { message: 'x', code: '08006' } });
      mockAdmin.mockReturnValue(client);
      const { POST } = await import('./route');
      const res = await POST(buildReq({ sesi_id: SESI, aksi: 'takeover' }));

      expect(res.status).toBe(200);
      expect(client.auditInsert).toHaveBeenCalled();
      const log = entri(errSpy, warnSpy).find((e) => e.operation === 'chat.sesi.pesan_sistem');
      expect(log).toMatchObject({ kode: 'database', asalCode: '08006' });
    });
  });
});
