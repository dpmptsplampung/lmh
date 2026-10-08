// @vitest-environment node
// Tahap 2: profil sendiri (PATCH lewat RPC), ubah sandi (verifikasi sandi lama), kirim ulang verifikasi.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
vi.mock('resend', () => ({ Resend: class { emails = { send: vi.fn().mockResolvedValue({ error: null }) }; } }));

import type { NextRequest } from 'next/server';

const ME = {
  id: 'p-1', nama: 'Helpdesk', username: 'helpdesk-oss', role: 'petugas', layanan_id: 'l1', no_hp: null,
  email_notifikasi: null, email_notifikasi_verified_at: null, operator_default: null, wajib_ganti_sandi: false,
  aktif: true, layanan: { nama: 'Helpdesk OSS' },
};
const req = (body?: unknown) =>
  new Request('http://localhost/api/me', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;

async function setup(o: { user?: unknown; me?: unknown; oldPwError?: boolean; jatah?: number } = {}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  process.env.NEXT_PUBLIC_PUBLIC_URL = 'http://app.local';
  process.env.RESEND_API_KEY = 're_test';
  const user = o.user === undefined ? { id: 'auth-1', email: 'helpdesk-oss@staf.lmh.internal' } : o.user;
  const rpc = vi.fn().mockResolvedValue({ error: null });
  const signOut = vi.fn().mockResolvedValue({});
  const serverMod = await import('@/lib/supabase/server');
  (serverMod.createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }), signOut },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: o.me === undefined ? ME : o.me }) }) }) }),
    rpc,
  });
  const updateUserById = vi.fn().mockResolvedValue({ error: null });
  const signIn = vi.fn().mockResolvedValue({ error: o.oldPwError ? { message: 'bad' } : null });
  const upserts: unknown[] = [];
  const updates: unknown[] = [];
  const sbMod = await import('@supabase/supabase-js');
  let n = 0;
  (sbMod.createClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
    n++;
    return {
      auth: { admin: { updateUserById }, signInWithPassword: signIn },
      from: () => {
        const c: Record<string, unknown> = {};
        const self = () => c;
        Object.assign(c, {
          select: self, eq: self, gte: self, is: self,
          then: (r: (v: unknown) => unknown) => Promise.resolve({ count: o.jatah ?? 0, error: null }).then(r),
          insert: async () => ({ error: null }),
          upsert: async (v: unknown) => { upserts.push(v); return { error: null }; },
          update: (v: unknown) => { updates.push(v); return { eq: async () => ({ error: null }) }; },
        });
        return c;
      },
    };
  });
  void n;
  return { rpc, signOut, updateUserById, signIn, upserts, updates };
}

describe('/api/me/profil', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
  it('401 tanpa login / akun nonaktif', async () => {
    await setup({ user: null });
    expect((await (await import('./profil/route')).GET()).status).toBe(401);
    vi.resetModules();
    await setup({ me: { ...ME, aktif: false } });
    expect((await (await import('./profil/route')).GET()).status).toBe(401);
  });
  it('GET: profil sendiri', async () => {
    await setup();
    const b = await (await (await import('./profil/route')).GET()).json();
    expect(b.profil).toMatchObject({ username: 'helpdesk-oss', layanan_nama: 'Helpdesk OSS', email_notifikasi_terverifikasi: false });
  });
  it('PATCH menolak kolom terlarang (role/username/layanan/aktif)', async () => {
    const s = await setup();
    const { PATCH } = await import('./profil/route');
    for (const k of ['role', 'username', 'layanan_id', 'aktif', 'nama']) {
      expect((await PATCH(req({ [k]: 'x' }))).status, k).toBe(400);
    }
    expect(s.rpc).not.toHaveBeenCalled();
  });
  it('PATCH: nomor HP dinormalisasi, lewat RPC sesi sendiri; email baru memicu token verifikasi', async () => {
    const s = await setup();
    const res = await (await import('./profil/route')).PATCH(req({ no_hp: '0812-3456-7890', email_notifikasi: 'Saya@Contoh.com', operator_default: 'Budi' }));
    expect(res.status).toBe(200);
    expect(s.rpc).toHaveBeenCalledWith('petugas_ubah_profil', {
      p_patch: { no_hp: '+6281234567890', email_notifikasi: 'saya@contoh.com', operator_default: 'Budi' },
    });
    expect((await res.json()).verifikasi_dikirim).toBe(true);
    const row = s.upserts[0] as { petugas_id: string; email: string; token_hash: string };
    expect(row).toMatchObject({ petugas_id: 'p-1', email: 'saya@contoh.com' });
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('PATCH: nomor HP tidak valid = 400', async () => {
    await setup();
    expect((await (await import('./profil/route')).PATCH(req({ no_hp: 'abc' }))).status).toBe(400);
  });
});

describe('POST /api/me/sandi', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
  it('sandi lama salah = 400, sandi tidak diubah', async () => {
    const s = await setup({ oldPwError: true });
    const res = await (await import('./sandi/route')).POST(req({ sandi_lama: 'lama-lama-1', sandi_baru: 'baru-baru-123' }));
    expect(res.status).toBe(400);
    expect(s.updateUserById).not.toHaveBeenCalled();
  });
  it('sandi baru pendek / sama dengan lama = 400', async () => {
    await setup();
    const { POST } = await import('./sandi/route');
    expect((await POST(req({ sandi_lama: 'lama-lama-1', sandi_baru: 'pendek' }))).status).toBe(400);
    expect((await POST(req({ sandi_lama: 'sama-sama-123', sandi_baru: 'sama-sama-123' }))).status).toBe(400);
  });
  it('berhasil: sandi diganti, wajib_ganti_sandi dibersihkan, perangkat lain dikeluarkan bila diminta', async () => {
    const s = await setup();
    const res = await (await import('./sandi/route')).POST(req({ sandi_lama: 'lama-lama-1', sandi_baru: 'baru-baru-123', keluarkan_perangkat_lain: true }));
    expect(res.status).toBe(200);
    expect(s.signIn).toHaveBeenCalledWith({ email: 'helpdesk-oss@staf.lmh.internal', password: 'lama-lama-1' });
    expect(s.updateUserById).toHaveBeenCalledWith('auth-1', { password: 'baru-baru-123' });
    expect(s.updates).toContainEqual({ wajib_ganti_sandi: false });
    expect(s.signOut).toHaveBeenCalledWith({ scope: 'others' });
  });
  it('rate limit: 429 bila percobaan melebihi jatah', async () => {
    const s = await setup({ jatah: 5 });
    const res = await (await import('./sandi/route')).POST(req({ sandi_lama: 'lama-lama-1', sandi_baru: 'baru-baru-123' }));
    expect(res.status).toBe(429);
    expect(s.signIn).not.toHaveBeenCalled();
  });
});

describe('POST /api/me/email-verifikasi', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
  it('400 bila belum ada email atau sudah terverifikasi; 200 bila perlu kirim', async () => {
    await setup();
    expect((await (await import('./email-verifikasi/route')).POST()).status).toBe(400);
    vi.resetModules();
    await setup({ me: { ...ME, email_notifikasi: 'a@b.co', email_notifikasi_verified_at: '2026-01-01' } });
    expect((await (await import('./email-verifikasi/route')).POST()).status).toBe(400);
    vi.resetModules();
    const s = await setup({ me: { ...ME, email_notifikasi: 'a@b.co' } });
    expect((await (await import('./email-verifikasi/route')).POST()).status).toBe(200);
    expect(s.upserts).toHaveLength(1);
  });
});
