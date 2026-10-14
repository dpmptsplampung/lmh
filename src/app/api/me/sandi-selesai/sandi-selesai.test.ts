// @vitest-environment node
// POST /api/me/sandi-selesai: pembersihan flag wajib_ganti_sandi setelah pemulihan sandi.
// Audit T2d (No 104): UPDATE ke petugas harus dicek (error DAN 0 baris), bukan hanya error.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

const ME = {
  id: 'p-1', nama: 'Helpdesk', username: 'helpdesk-oss', role: 'petugas', layanan_id: 'l1', no_hp: null,
  email_notifikasi: null, email_notifikasi_verified_at: null, operator_default: null, wajib_ganti_sandi: true,
  aktif: true, layanan: { nama: 'Helpdesk OSS' },
};

interface Opts {
  me?: unknown;
  amr?: string;
  updatedAt?: string;
  updateError?: { message: string; code?: string };
  updateRows?: unknown[];
}

async function setup(o: Opts = {}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';

  const serverMod = await import('@/lib/supabase/server');
  (serverMod.createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'auth-1', email: 'x@staf.lmh.internal', updated_at: o.updatedAt ?? new Date().toISOString() } },
      }),
      getClaims: vi.fn().mockResolvedValue({ data: { claims: { amr: [{ method: o.amr ?? 'otp' }] } } }),
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: o.me === undefined ? ME : o.me }) }) }) }),
  });

  const updates: unknown[] = [];
  const selects: unknown[] = [];
  const inserts: unknown[] = [];
  const sbMod = await import('@supabase/supabase-js');
  (sbMod.createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    from: () => ({
      insert: async (v: unknown) => { inserts.push(v); return { error: null }; },
      update: (v: unknown) => {
        updates.push(v);
        return {
          eq: () => ({
            select: async (cols?: string) => {
              selects.push(cols);
              return o.updateError
                ? { data: null, error: o.updateError }
                : { data: o.updateRows ?? [{ id: 'p-1' }], error: null };
            },
          }),
        };
      },
    }),
  });
  return { updates, selects, inserts };
}

describe('POST /api/me/sandi-selesai', () => {
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

  const log = () =>
    errSpy.mock.calls
      .map((c: unknown[]) => { try { return JSON.parse(String(c[0])) as Record<string, unknown>; } catch { return null; } })
      .find((e: Record<string, unknown> | null) => e?.operation === 'me.sandi_selesai.flag');

  it('sudah bersih: tidak menulis apa pun', async () => {
    const s = await setup({ me: { ...ME, wajib_ganti_sandi: false } });
    const res = await (await import('./route')).POST();
    expect(await res.json()).toEqual({ ok: true, sudah_bersih: true });
    expect(s.updates).toHaveLength(0);
  });

  it('berhasil: flag dibersihkan (baris terdampak dicek lewat .select), audit ditulis, respons {ok:true}', async () => {
    const s = await setup();
    const res = await (await import('./route')).POST();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(s.updates).toEqual([{ wajib_ganti_sandi: false }]);
    expect(s.selects).toEqual(['id']);
    expect((s.inserts[0] as Record<string, unknown>).aksi).toBe('akun_ganti_sandi_pemulihan');
  });

  it('UPDATE error: 500 tanpa audit; dicatat dengan kode, tanpa pesan teknis', async () => {
    const s = await setup({ updateError: { message: 'connection reset secret-xyz', code: '08006' } });
    const res = await (await import('./route')).POST();

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Gagal memperbarui status');
    expect(s.inserts).toHaveLength(0);
    expect(log()).toMatchObject({ kode: 'database', asalCode: '08006' });
    expect(JSON.stringify(log())).not.toContain('secret-xyz');
  });

  it('UPDATE 0 baris tanpa error: tetap 500 (bukan sukses palsu) dan tanpa audit', async () => {
    const s = await setup({ updateRows: [] });
    const res = await (await import('./route')).POST();

    expect(res.status).toBe(500);
    expect(s.inserts).toHaveLength(0);
    expect(log()).toMatchObject({ kode: 'tidak_ada_baris' });
  });
});
