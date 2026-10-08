// @vitest-environment node
// Tahap 2: lupa sandi mandiri (anti-enumerasi) dan verifikasi email notifikasi.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
const send = vi.fn().mockResolvedValue({ error: null });
vi.mock('resend', () => ({ Resend: class { emails = { send }; } }));

import { NextRequest } from 'next/server';

const req = (url: string, body?: unknown) =>
  new NextRequest(url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

async function setup(o: { petugas?: unknown; count?: number; verif?: unknown } = {}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  process.env.NEXT_PUBLIC_PUBLIC_URL = 'http://app.local';
  process.env.RESEND_API_KEY = 're_test';
  const generateLink = vi.fn().mockResolvedValue({ data: { properties: { action_link: 'http://supabase.local/verify?x=1' } }, error: null });
  const rpc = vi.fn().mockResolvedValue({ data: o.verif ?? null, error: null });
  const sb = await import('@supabase/supabase-js');
  (sb.createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    rpc,
    auth: { admin: { generateLink, getUserById: vi.fn().mockResolvedValue({ data: { user: { email: 'helpdesk-oss@staf.lmh.internal' } } }) } },
    from: () => {
      const c: Record<string, unknown> = {};
      const self = () => c;
      Object.assign(c, {
        select: self, eq: self, gte: self, is: self,
        maybeSingle: async () => ({ data: o.petugas ?? null }),
        then: (r: (v: unknown) => unknown) => Promise.resolve({ count: o.count ?? 0, error: null }).then(r),
        insert: async () => ({ error: null }),
      });
      return c;
    },
  });
  return { generateLink, rpc };
}
const OK_PETUGAS = { auth_user_id: 'a1', nama: 'Helpdesk', aktif: true, email_notifikasi: 'asli@contoh.com', email_notifikasi_verified_at: '2026-01-01' };

describe('POST /api/auth/lupa-sandi', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
  it('akun valid + email terverifikasi: tautan dikirim ke email notifikasi (bukan email sintetis)', async () => {
    const s = await setup({ petugas: OK_PETUGAS });
    const res = await (await import('./lupa-sandi/route')).POST(req('http://x/api/auth/lupa-sandi', { username: 'Helpdesk-OSS' }));
    expect(res.status).toBe(200);
    expect(s.generateLink).toHaveBeenCalled();
    expect(send.mock.calls[0][0].to).toBe('asli@contoh.com');
  });
  it('akun tak ada / email belum terverifikasi / nonaktif: jawaban IDENTIK, tidak ada email', async () => {
    const jawaban: unknown[] = [];
    for (const p of [null, { ...OK_PETUGAS, email_notifikasi_verified_at: null }, { ...OK_PETUGAS, aktif: false }]) {
      vi.resetModules();
      const s = await setup({ petugas: p });
      const res = await (await import('./lupa-sandi/route')).POST(req('http://x/api/auth/lupa-sandi', { username: 'siapa-saja' }));
      jawaban.push([res.status, await res.json()]);
      expect(s.generateLink).not.toHaveBeenCalled();
    }
    expect(send).not.toHaveBeenCalled();
    expect(new Set(jawaban.map((j) => JSON.stringify(j))).size).toBe(1);
  });
  it('rate limit: 429 tanpa mencari akun', async () => {
    const s = await setup({ petugas: OK_PETUGAS, count: 99 });
    const res = await (await import('./lupa-sandi/route')).POST(req('http://x/api/auth/lupa-sandi', { username: 'helpdesk-oss' }));
    expect(res.status).toBe(429);
    expect(s.generateLink).not.toHaveBeenCalled();
  });
});

describe('GET /api/auth/verifikasi-email', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
  it('token valid -> redirect ok; hash SHA-256 dikirim ke RPC (bukan token mentah)', async () => {
    const s = await setup({ verif: 'p-1' });
    const token = 'a'.repeat(43);
    const res = await (await import('./verifikasi-email/route')).GET(req(`http://x/api/auth/verifikasi-email?token=${token}`));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('email_verif=ok');
    expect(s.rpc.mock.calls[0][1].p_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(s.rpc.mock.calls)).not.toContain(token);
  });
  it('token salah/kedaluwarsa atau kosong -> gagal', async () => {
    await setup({ verif: null });
    const { GET } = await import('./verifikasi-email/route');
    expect((await GET(req(`http://x/api/auth/verifikasi-email?token=${'b'.repeat(43)}`))).headers.get('location')).toContain('gagal');
    expect((await GET(req('http://x/api/auth/verifikasi-email'))).headers.get('location')).toContain('gagal');
  });
});
