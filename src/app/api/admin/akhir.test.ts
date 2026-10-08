// @vitest-environment node
// Gelombang penutup RBAC: Kelola Layanan, buku tamu, riwayat, buat akun, sandi-selesai. Semua klien dimock.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

const ID = '660e8400-e29b-41d4-a716-446655440001';
type Calls = Record<string, Array<[string, unknown[]]>>;
type Result = { data?: unknown; error?: { code?: string; message: string } | null; count?: number; ins?: Result };

// Rantai query "thenable": semua metode mengembalikan dirinya, await -> hasil kaleng; dicatat per tabel.
function chain(table: string, result: Result, calls: Calls) {
  const b: unknown = new Proxy({}, {
    get: (_t, k: string) => {
      if (k === 'then') {
        // `ins` = hasil khusus bila rantai ini berisi insert (pemeriksaan duplikat vs penyimpanan di tabel yang sama)
        const r = result.ins && calls[table]?.some(([m]) => m === 'insert') ? result.ins : result;
        return (res: (v: unknown) => unknown) => res({ error: null, ...r });
      }
      return (...a: unknown[]) => { (calls[table] ??= []).push([k, a]); return b; };
    },
  });
  return b;
}

async function setup(o: {
  role?: string | null;            // peran pemanggil (null = nonaktif/tidak ada)
  tables?: Record<string, Result>;
  svcTables?: Record<string, Result>;
  amr?: string;
  updatedAt?: string;
  wajibGanti?: boolean;
  createUser?: { data?: unknown; error?: { message: string } | null };
} = {}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  const role = o.role === undefined ? 'admin' : o.role;
  const actor = role
    ? { id: 'p-actor', role, aktif: true, nama: 'A', username: 'a', layanan_id: null, wajib_ganti_sandi: o.wajibGanti ?? true }
    : null;
  const calls: Calls = {};
  const svcCalls: Calls = {};
  const deleteUser = vi.fn().mockResolvedValue({ error: null });
  const createUser = vi.fn().mockResolvedValue(o.createUser ?? { data: { user: { id: 'auth-new' } }, error: null });

  const serverMod = await import('@/lib/supabase/server');
  (serverMod.createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'auth-actor', updated_at: o.updatedAt ?? new Date().toISOString() } } }),
      getClaims: vi.fn().mockResolvedValue({ data: { claims: { amr: [{ method: o.amr ?? 'otp' }] } } }),
    },
    from: (t: string) => chain(t, t === 'petugas' ? { data: actor } : (o.tables?.[t] ?? { data: null }), calls),
  });
  const sbMod = await import('@supabase/supabase-js');
  (sbMod.createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    from: (t: string) => chain(t, o.svcTables?.[t] ?? { data: null }, svcCalls),
    auth: { admin: { createUser, deleteUser } },
  });
  return { calls, svcCalls, createUser, deleteUser };
}

const req = (method: string, body?: unknown, url = 'http://localhost/api/x') => {
  const r = new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
  (r as unknown as { nextUrl: URL }).nextUrl = new URL(url);
  return r;
};
const ctx = { params: Promise.resolve({ id: ID }) };
const callOf = (calls: Calls, table: string, fn: string) => calls[table]?.find(([k]) => k === fn)?.[1];

beforeEach(() => vi.resetModules());

describe('layanan', () => {
  it('GET: petugas ditolak, FO hanya lihat, Admin bisa ubah', async () => {
    let s = await setup({ role: 'petugas' });
    let { GET } = await import('./layanan/route');
    expect((await GET()).status).toBe(403);
    vi.resetModules();
    s = await setup({ role: 'front_office', tables: { layanan: { data: [{ id: ID }] } } });
    ({ GET } = await import('./layanan/route'));
    let res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).bisa_ubah).toBe(false);
    vi.resetModules();
    s = await setup({ role: 'admin', tables: { layanan: { data: [] } } });
    ({ GET } = await import('./layanan/route'));
    res = await GET();
    expect((await res.json()).bisa_ubah).toBe(true);
    expect(s.calls.layanan.some(([k]) => k === 'select')).toBe(true);
  });

  it('PATCH: FO 403; kunci terlarang (chatbot_aktif/aktif) 400; prefiks tidak valid 400', async () => {
    await setup({ role: 'front_office' });
    const { PATCH } = await import('./layanan/[id]/route');
    expect((await PATCH(req('PATCH', { nama: 'Baru' }), ctx)).status).toBe(403);
    vi.resetModules();
    await setup();
    const m = await import('./layanan/[id]/route');
    expect((await m.PATCH(req('PATCH', { chatbot_aktif: true }), ctx)).status).toBe(400);
    expect((await m.PATCH(req('PATCH', { aktif: false }), ctx)).status).toBe(400);
    expect((await m.PATCH(req('PATCH', { prefiks: '12' }), ctx)).status).toBe(400);
    expect((await m.PATCH(req('PATCH', {}), ctx)).status).toBe(400);
    expect((await m.PATCH(req('PATCH', { status_tampilan: 'tampil' }), ctx)).status).toBe(400);
  });

  it('PATCH: menulis lewat sesi Admin (bukan service), prefiks jadi huruf besar & dipetakan ke prefiks_antrean', async () => {
    const s = await setup({ tables: { layanan: { data: { id: ID } } } });
    const { PATCH } = await import('./layanan/[id]/route');
    const res = await PATCH(req('PATCH', { prefiks: 'ab', nomor_loket: '3', tampil_di_layar: false, status_tampilan: 'coming_soon' }), ctx);
    expect(res.status).toBe(200);
    expect(callOf(s.calls, 'layanan', 'update')?.[0]).toEqual({
      nomor_loket: '3', tampil_di_layar: false, status_tampilan: 'coming_soon', prefiks_antrean: 'AB',
    });
    expect(s.svcCalls.layanan).toBeUndefined();
  });

  it('PATCH: 404 bila tidak ada, 409 bila nama/prefiks bentrok', async () => {
    await setup({ tables: { layanan: { data: null } } });
    expect((await (await import('./layanan/[id]/route')).PATCH(req('PATCH', { nama: 'Zz' }), ctx)).status).toBe(404);
    vi.resetModules();
    await setup({ tables: { layanan: { data: null, error: { code: '23505', message: 'dup' } } } });
    expect((await (await import('./layanan/[id]/route')).PATCH(req('PATCH', { nama: 'Zz' }), ctx)).status).toBe(409);
  });

  it('PATCH: rename yang mengubah jenis form pendataan ditolak 422; rename aman lolos', async () => {
    const s = await setup({ tables: { layanan: { data: { id: ID, nama: 'Layanan OSS' } } } });
    const m = await import('./layanan/[id]/route');
    expect((await m.PATCH(req('PATCH', { nama: 'Layanan Umum' }), ctx)).status).toBe(422);
    expect((await m.PATCH(req('PATCH', { nama: 'Layanan Non OSS' }), ctx)).status).toBe(422);
    expect(callOf(s.calls, 'layanan', 'update')).toBeUndefined();
    expect((await m.PATCH(req('PATCH', { nama: 'Layanan OSS Terpadu' }), ctx)).status).toBe(200);
  });

  it('bot: Admin saja', async () => {
    await setup({ role: 'front_office' });
    expect((await (await import('./layanan/[id]/bot/route')).PATCH(req('PATCH', { aktif: true }), ctx)).status).toBe(403);
    vi.resetModules();
    const s = await setup({ tables: { layanan: { data: { id: ID, chatbot_aktif: true } } } });
    const m = await import('./layanan/[id]/bot/route');
    expect((await m.PATCH(req('PATCH', { aktif: 'ya' }), ctx)).status).toBe(400);
    const res = await m.PATCH(req('PATCH', { aktif: true }), ctx);
    expect(res.status).toBe(200);
    expect(callOf(s.calls, 'layanan', 'update')?.[0]).toEqual({ chatbot_aktif: true });
  });
});

describe('buku tamu', () => {
  it('petugas ditolak', async () => {
    await setup({ role: 'petugas' });
    const m = await import('./buku-tamu/route');
    expect((await m.GET(req('GET', undefined, 'http://localhost/api/admin/buku-tamu'))).status).toBe(403);
    expect((await m.POST(req('POST', { nama: 'Budi', bertemu: 'Kabid' }))).status).toBe(403);
  });

  it('FO mencatat tamu: dicatat_oleh = staf penulis, kolom dipetakan, HP dinormalisasi', async () => {
    const row = { id: ID, nama: 'Budi', asal: 'CV X', no_hp: '+628123456789', menemui_siapa: 'Kabid', keperluan: 'Audiensi', waktu_masuk: 'x', dicatat_oleh: 'p-actor' };
    const s = await setup({ role: 'front_office', tables: { buku_tamu: { data: row } } });
    const { POST } = await import('./buku-tamu/route');
    const res = await POST(req('POST', { nama: 'Budi', instansi: 'CV X', no_hp: '08123456789', bertemu: 'Kabid', tujuan: 'Audiensi' }));
    expect(res.status).toBe(201);
    expect((await res.json()).tamu).toMatchObject({ instansi: 'CV X', bertemu: 'Kabid', tujuan: 'Audiensi' });
    expect(callOf(s.calls, 'buku_tamu', 'insert')?.[0]).toMatchObject({
      dicatat_oleh: 'p-actor', menemui_siapa: 'Kabid', asal: 'CV X', no_hp: '+628123456789',
    });
  });

  it('menolak waktu di masa depan / HP salah / kunci asing', async () => {
    await setup({ role: 'admin' });
    const { POST } = await import('./buku-tamu/route');
    const depan = new Date(Date.now() + 3_600_000).toISOString();
    expect((await POST(req('POST', { nama: 'Budi', bertemu: 'Kabid', waktu_masuk: depan }))).status).toBe(400);
    expect((await POST(req('POST', { nama: 'Budi', bertemu: 'Kabid', no_hp: 'abc' }))).status).toBe(400);
    expect((await POST(req('POST', { nama: 'Budi', bertemu: 'Kabid', dicatat_oleh: 'x' }))).status).toBe(400);
  });

  it('GET memakai rentang WIB (default hari ini) dan paginasi', async () => {
    const s = await setup({ role: 'front_office', tables: { buku_tamu: { data: [], count: 0 } } });
    const { GET } = await import('./buku-tamu/route');
    const res = await GET(req('GET', undefined, 'http://localhost/api/admin/buku-tamu?dari=2026-10-01&sampai=2026-10-02&page=2&limit=10'));
    expect(res.status).toBe(200);
    expect(callOf(s.calls, 'buku_tamu', 'gte')).toEqual(['waktu_masuk', '2026-10-01T00:00:00+07:00']);
    expect(callOf(s.calls, 'buku_tamu', 'range')).toEqual([10, 19]);
  });
});

describe('riwayat', () => {
  it('Admin saja', async () => {
    await setup({ role: 'front_office' });
    const { GET } = await import('./riwayat/route');
    expect((await GET(req('GET', undefined, 'http://localhost/api/admin/riwayat'))).status).toBe(403);
  });

  it('validasi query + nama pelaku dipetakan dari petugas.id maupun auth_user_id', async () => {
    const log = [
      { id: 1, actor_id: 'p-1', aksi: 'layanan_ubah', entitas: 'layanan', nilai_lama: { nama: 'A' }, nilai_baru: { nama: 'B' } },
      { id: 2, actor_id: 'auth-2', aksi: 'site_settings_ubah', entitas: 'site_settings' },
      { id: 3, actor_id: null, aksi: 'x', entitas: 'y' },
    ];
    await setup({
      svcTables: {
        audit_log: { data: log, count: 3 },
        petugas: { data: [{ id: 'p-1', auth_user_id: 'auth-1', nama: 'Siti', username: 'siti' }, { id: 'p-2', auth_user_id: 'auth-2', nama: 'Ani', username: null }] },
      },
    });
    const { GET } = await import('./riwayat/route');
    expect((await GET(req('GET', undefined, 'http://localhost/api/admin/riwayat?orang=bukan-uuid'))).status).toBe(400);
    expect((await GET(req('GET', undefined, 'http://localhost/api/admin/riwayat?limit=500'))).status).toBe(400);
    const res = await GET(req('GET', undefined, 'http://localhost/api/admin/riwayat?jenis=layanan&dari=2026-10-01'));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.total).toBe(3);
    expect(j.items.map((i: { pelaku: unknown }) => i.pelaku)).toEqual([
      { nama: 'Siti', username: 'siti' }, { nama: 'Ani', username: null }, null,
    ]);
  });
});

describe('POST /api/admin/petugas (buat akun)', () => {
  const ok = { username: 'loket-oss', nama: 'Loket OSS', role: 'petugas', layanan_id: ID };

  it('FO ditolak; role petugas tanpa layanan / username terlarang / kunci asing -> 400', async () => {
    await setup({ role: 'front_office' });
    expect((await (await import('./petugas/route')).POST(req('POST', ok))).status).toBe(403);
    vi.resetModules();
    await setup();
    const { POST } = await import('./petugas/route');
    expect((await POST(req('POST', { ...ok, layanan_id: null }))).status).toBe(400);
    expect((await POST(req('POST', { ...ok, username: 'admin' }))).status).toBe(400);
    expect((await POST(req('POST', { ...ok, aktif: false }))).status).toBe(400);
    expect((await POST(req('POST', { ...ok, sandi_sementara: 'pendek' }))).status).toBe(400);
  });

  it('username sudah dipakai -> 409 tanpa membuat akun auth', async () => {
    const s = await setup({ svcTables: { petugas: { data: { id: 'ada' } } } });
    const res = await (await import('./petugas/route')).POST(req('POST', ok));
    expect(res.status).toBe(409);
    expect(s.createUser).not.toHaveBeenCalled();
  });

  it('sukses: email sintetis, wajib_ganti_sandi, sandi dikembalikan sekali, tidak masuk audit', async () => {
    const s = await setup({ svcTables: { petugas: { data: null, ins: { data: { id: 'p-new' } } } } });
    const res = await (await import('./petugas/route')).POST(req('POST', { ...ok, no_hp: '08123456789' }));
    const j = await res.json();
    expect(res.status).toBe(201);
    expect(s.createUser.mock.calls[0][0]).toMatchObject({ email: 'loket-oss@staf.lmh.internal', email_confirm: true });
    expect(j.sandi_sementara).toBe(s.createUser.mock.calls[0][0].password);
    expect(j.sandi_sementara.length).toBeGreaterThanOrEqual(10);
    const ins = callOf(s.svcCalls, 'petugas', 'insert')?.[0] as Record<string, unknown>;
    expect(ins).toMatchObject({ auth_user_id: 'auth-new', username: 'loket-oss', role: 'petugas', layanan_id: ID, wajib_ganti_sandi: true, aktif: true, no_hp: '+628123456789' });
    expect(JSON.stringify(s.svcCalls.audit_log)).not.toContain(j.sandi_sementara);
  });

  it('role front_office/admin: layanan_id dikosongkan', async () => {
    const s = await setup({ svcTables: { petugas: { data: null, ins: { data: { id: 'p-new' } } } } });
    const res = await (await import('./petugas/route')).POST(req('POST', { ...ok, role: 'front_office' }));
    expect(res.status).toBe(201);
    expect((callOf(s.svcCalls, 'petugas', 'insert')?.[0] as Record<string, unknown>).layanan_id).toBeNull();
  });

  it('insert petugas gagal -> akun auth dibatalkan (tidak yatim)', async () => {
    const s = await setup({ svcTables: { petugas: { data: null, ins: { data: null, error: { code: '23503', message: 'fk' } } } } });
    const res = await (await import('./petugas/route')).POST(req('POST', ok));
    expect(res.status).toBe(400);
    expect(s.deleteUser).toHaveBeenCalledWith('auth-new');
  });
});

describe('POST /api/me/sandi-selesai', () => {
  it('sesi login-sandi ditolak; sandi belum diganti (usang) 409; sukses membersihkan flag', async () => {
    await setup({ amr: 'password' });
    expect((await (await import('../me/sandi-selesai/route')).POST()).status).toBe(403);
    vi.resetModules();
    await setup({ updatedAt: new Date(Date.now() - 3_600_000).toISOString() });
    expect((await (await import('../me/sandi-selesai/route')).POST()).status).toBe(409);
    vi.resetModules();
    const s = await setup({ amr: 'otp' });
    const res = await (await import('../me/sandi-selesai/route')).POST();
    expect(res.status).toBe(200);
    expect(callOf(s.svcCalls, 'petugas', 'update')?.[0]).toEqual({ wajib_ganti_sandi: false });
  });

  it('flag sudah bersih -> no-op; tanpa login 401', async () => {
    const s = await setup({ wajibGanti: false });
    const res = await (await import('../me/sandi-selesai/route')).POST();
    expect((await res.json()).sudah_bersih).toBe(true);
    expect(s.svcCalls.petugas).toBeUndefined();
    vi.resetModules();
    await setup({ role: null });
    expect((await (await import('../me/sandi-selesai/route')).POST()).status).toBe(401);
  });
});
