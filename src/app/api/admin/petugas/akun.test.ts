// @vitest-environment node
// Tahap 2: daftar akun, edit akun (username -> email login sintetis), reset sandi. Semua klien dimock.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

import type { NextRequest } from 'next/server';

const ID = '660e8400-e29b-41d4-a716-446655440001';
const ADMIN = { id: 'p-admin', role: 'admin', aktif: true };
const TARGET = { id: ID, auth_user_id: 'auth-t', role: 'petugas', layanan_id: 'l-1', username: 'lama-user', email_notifikasi: null };

const req = (method: string, body?: unknown) =>
  new Request('http://localhost/api/admin/petugas', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });

async function setup(o: {
  user?: { id: string } | null;
  actor?: { id: string; role: string; aktif: boolean } | null;
  target?: unknown;
  updateError?: { code?: string; message: string } | null;
  authError?: { message: string } | null;
} = {}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  const user = o.user === undefined ? { id: 'auth-admin' } : o.user;
  const serverMod = await import('@/lib/supabase/server');
  (serverMod.createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: o.actor === undefined ? ADMIN : o.actor }) }) }) }),
  });
  const updates: Array<{ table: string; values: unknown }> = [];
  const inserts: Array<{ table: string; values: unknown }> = [];
  const rpc = vi.fn().mockResolvedValue({ data: [{ id: 'x', belum_pernah_login: true }], error: null });
  const updateUserById = vi.fn().mockResolvedValue({ error: o.authError ?? null });
  const sbMod = await import('@supabase/supabase-js');
  (sbMod.createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    rpc,
    auth: { admin: { updateUserById } },
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: o.target === undefined ? TARGET : o.target }) }) }),
      update: (values: unknown) => {
        updates.push({ table, values });
        return { eq: async () => ({ error: updates.length === 1 ? (o.updateError ?? null) : null }) };
      },
      insert: async (values: unknown) => { inserts.push({ table, values }); return { error: null }; },
    }),
  });
  return { rpc, updateUserById, updates, inserts };
}

describe('GET /api/admin/petugas', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
  it('401 / 403 untuk non-admin', async () => {
    await setup({ user: null });
    expect((await (await import('./route')).GET()).status).toBe(401);
    vi.resetModules();
    await setup({ actor: { id: 'p', role: 'front_office', aktif: true } });
    expect((await (await import('./route')).GET()).status).toBe(403);
  });
  it('Admin mendapat daftar dari RPC akun_daftar', async () => {
    const { rpc } = await setup();
    const res = await (await import('./route')).GET();
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('akun_daftar');
    expect((await res.json()).akun).toHaveLength(1);
  });
});

describe('PATCH /api/admin/petugas/[id]', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  it('FO ditolak (403), tanpa menyentuh Auth', async () => {
    const s = await setup({ actor: { id: 'p', role: 'front_office', aktif: true } });
    const res = await (await import('./[id]/route')).PATCH(req('PATCH', { nama: 'Baru' }), ctx());
    expect(res.status).toBe(403);
    expect(s.updateUserById).not.toHaveBeenCalled();
  });
  it('kunci tak dikenal / kosong / username jelek = 400', async () => {
    await setup();
    const { PATCH } = await import('./[id]/route');
    expect((await PATCH(req('PATCH', { aktif: false }), ctx())).status).toBe(400);
    expect((await PATCH(req('PATCH', {}), ctx())).status).toBe(400);
    expect((await PATCH(req('PATCH', { username: 'Ab' }), ctx())).status).toBe(400);
  });
  it('ganti username: petugas diubah, email login sintetis diset, sesi target diakhiri, diaudit', async () => {
    const s = await setup();
    const res = await (await import('./[id]/route')).PATCH(req('PATCH', { username: ' Helpdesk-OSS ', no_hp: '0812 3456 7890' }), ctx());
    expect(res.status).toBe(200);
    expect(s.updates[0]).toEqual({ table: 'petugas', values: { no_hp: '+6281234567890', username: 'helpdesk-oss' } });
    expect(s.updateUserById).toHaveBeenCalledWith('auth-t', { email: 'helpdesk-oss@staf.lmh.internal', email_confirm: true });
    expect(s.rpc).toHaveBeenCalledWith('akun_akhiri_sesi', { p_auth_user_id: 'auth-t' });
    expect(s.inserts[0].table).toBe('audit_log');
  });
  it('username bentrok (23505) = 409, Auth tidak disentuh', async () => {
    const s = await setup({ updateError: { code: '23505', message: 'dup' } });
    const res = await (await import('./[id]/route')).PATCH(req('PATCH', { username: 'sudah-dipakai' }), ctx());
    expect(res.status).toBe(409);
    expect(s.updateUserById).not.toHaveBeenCalled();
  });
  it('sinkron Auth gagal: username dikembalikan, 502', async () => {
    const s = await setup({ authError: { message: 'boom' } });
    const res = await (await import('./[id]/route')).PATCH(req('PATCH', { username: 'baru-user' }), ctx());
    expect(res.status).toBe(502);
    expect(s.updates[1]).toEqual({ table: 'petugas', values: { username: 'lama-user' } });
  });
  it('tidak boleh mengubah role sendiri (403); Admin terakhir dijaga DB (409)', async () => {
    await setup({ target: { ...TARGET, id: 'p-admin', role: 'admin' } });
    let mod = await import('./[id]/route');
    expect((await mod.PATCH(req('PATCH', { role: 'petugas', layanan_id: '660e8400-e29b-41d4-a716-446655440008' }), ctx('660e8400-e29b-41d4-a716-446655440009'))).status).toBe(403);
    vi.resetModules();
    await setup({ target: { ...TARGET, role: 'admin' }, updateError: { message: 'tidak boleh menurunkan atau menonaktifkan Admin aktif terakhir' } });
    mod = await import('./[id]/route');
    expect((await mod.PATCH(req('PATCH', { role: 'front_office' }), ctx())).status).toBe(409);
  });
  it('role petugas wajib layanan', async () => {
    await setup({ target: { ...TARGET, role: 'front_office', layanan_id: null } });
    const res = await (await import('./[id]/route')).PATCH(req('PATCH', { role: 'petugas' }), ctx());
    expect(res.status).toBe(400);
  });
  it('email_notifikasi baru menghapus status verifikasi', async () => {
    const s = await setup();
    await (await import('./[id]/route')).PATCH(req('PATCH', { email_notifikasi: 'Orang@Contoh.com' }), ctx());
    expect(s.updates[0].values).toEqual({ email_notifikasi: 'orang@contoh.com', email_notifikasi_verified_at: null });
    expect(s.updateUserById).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/petugas/[id]/reset-password', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
  it('Admin mereset: sandi sementara, wajib ganti, sesi diakhiri; tidak ke audit', async () => {
    const s = await setup();
    const res = await (await import('./[id]/reset-password/route')).POST(req('POST'), ctx());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.sandi_sementara).toMatch(/^[A-Za-z2-9]{14}$/);
    expect(s.updateUserById).toHaveBeenCalledWith('auth-t', { password: body.sandi_sementara });
    expect(s.updates[0].values).toEqual({ wajib_ganti_sandi: true });
    expect(s.rpc).toHaveBeenCalledWith('akun_akhiri_sesi', { p_auth_user_id: 'auth-t' });
    expect(JSON.stringify(s.inserts)).not.toContain(body.sandi_sementara);
  });
  it('tidak bisa mereset diri sendiri; non-admin 403', async () => {
    await setup();
    const { POST } = await import('./[id]/reset-password/route');
    expect((await POST(req('POST'), ctx('p-admin'))).status).toBe(400); // bukan uuid
    vi.resetModules();
    await setup({ actor: { id: ID, role: 'admin', aktif: true } });
    expect((await (await import('./[id]/reset-password/route')).POST(req('POST'), ctx())).status).toBe(403);
    vi.resetModules();
    await setup({ actor: { id: 'p', role: 'petugas', aktif: true } });
    expect((await (await import('./[id]/reset-password/route')).POST(req('POST'), ctx())).status).toBe(403);
  });
});
