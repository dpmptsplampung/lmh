// @vitest-environment node
// Tahap 2: daftar akun, edit akun (username -> email login sintetis), reset sandi. Semua klien dimock.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/observability/logger', () => ({ logServerEvent: vi.fn() }));

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
  /** Hasil UPDATE petugas ke-N (urutan panggilan, mulai 0); menimpa updateError. data = baris terdampak. */
  updateResults?: Array<{ data?: unknown; error?: { code?: string; message: string } | null }>;
  authError?: { message: string } | null;
  /** Galat RPC akun_akhiri_sesi (sesi lama target gagal diakhiri). */
  sesiError?: { code?: string; message: string } | null;
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
  const rpc = vi.fn(async (nama: string) =>
    nama === 'akun_akhiri_sesi' && o.sesiError
      ? { data: null, error: o.sesiError }
      : { data: [{ id: 'x', belum_pernah_login: true }], error: null });
  const updateUserById = vi.fn().mockResolvedValue({ error: o.authError ?? null });
  const sbMod = await import('@supabase/supabase-js');
  (sbMod.createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    rpc,
    auth: { admin: { updateUserById } },
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: o.target === undefined ? TARGET : o.target }) }) }),
      // UPDATE kini berakhir .select('id') (mutasiWajibBaris): rantai .update().eq().select() -> { data: baris, error }.
      update: (values: unknown) => {
        updates.push({ table, values });
        const n = updates.length - 1;
        const hasil = o.updateResults?.[n]
          ?? { data: [{ id: ID }], error: n === 0 ? (o.updateError ?? null) : null };
        return { eq: () => ({ select: async () => ({ data: hasil.error ? null : [{ id: ID }], ...hasil }) }) };
      },
      insert: async (values: unknown) => { inserts.push({ table, values }); return { error: null }; },
    }),
  });
  const logger = await import('@/lib/observability/logger');
  const log = vi.mocked(logger.logServerEvent);
  log.mockClear();
  return { rpc, updateUserById, updates, inserts, log };
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
  // ---- FAQ umum (keputusan CEO): FO/Admin lintas layanan -> layanan_id HARUS null ----
  const LAY = '660e8400-e29b-41d4-a716-446655440008';
  it('layanan_id diisi untuk role front_office/admin = 400, tidak ada UPDATE', async () => {
    const kasus: Array<[unknown, Record<string, unknown>]> = [
      [{ ...TARGET, role: 'front_office', layanan_id: null }, { layanan_id: LAY }],
      [{ ...TARGET, role: 'admin', layanan_id: null }, { layanan_id: LAY }],
      [TARGET, { role: 'front_office', layanan_id: LAY }],
      [TARGET, { role: 'admin', layanan_id: LAY }],
    ];
    for (const [target, body] of kasus) {
      vi.resetModules();
      const s = await setup({ target });
      const res = await (await import('./[id]/route')).PATCH(req('PATCH', body), ctx());
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(JSON.stringify(await res.json())).toMatch(/layanan_id/);
      expect(s.updates).toHaveLength(0);
    }
  });
  it('role diubah petugas -> front_office/admin tanpa layanan_id: layanan_id dikosongkan otomatis', async () => {
    for (const role of ['front_office', 'admin']) {
      vi.resetModules();
      const s = await setup(); // TARGET = petugas dengan layanan l-1
      const res = await (await import('./[id]/route')).PATCH(req('PATCH', { role }), ctx());
      expect(res.status, role).toBe(200);
      expect(s.updates[0]).toEqual({ table: 'petugas', values: { role, layanan_id: null } });
    }
  });
  it('FO lama yang masih membawa layanan_id (sisa data): ikut dikosongkan pada PATCH berikutnya; null eksplisit diterima', async () => {
    let s = await setup({ target: { ...TARGET, role: 'front_office', layanan_id: 'l-1' } });
    let res = await (await import('./[id]/route')).PATCH(req('PATCH', { nama: 'Nama Baru' }), ctx());
    expect(res.status).toBe(200);
    expect(s.updates[0].values).toEqual({ nama: 'Nama Baru', layanan_id: null });
    vi.resetModules();
    s = await setup({ target: { ...TARGET, role: 'front_office', layanan_id: 'l-1' } });
    res = await (await import('./[id]/route')).PATCH(req('PATCH', { layanan_id: null }), ctx());
    expect(res.status).toBe(200);
    expect(s.updates[0].values).toEqual({ layanan_id: null });
  });
  it('role petugas: layanan_id tetap bisa diubah; petugas tanpa layanan tetap 400; FO -> petugas dengan layanan_id OK', async () => {
    let s = await setup();
    let res = await (await import('./[id]/route')).PATCH(req('PATCH', { layanan_id: LAY }), ctx());
    expect(res.status).toBe(200);
    expect(s.updates[0].values).toEqual({ layanan_id: LAY });
    vi.resetModules();
    s = await setup();
    res = await (await import('./[id]/route')).PATCH(req('PATCH', { layanan_id: null }), ctx());
    expect(res.status).toBe(400);
    expect(s.updates).toHaveLength(0);
    vi.resetModules();
    s = await setup({ target: { ...TARGET, role: 'front_office', layanan_id: null } });
    res = await (await import('./[id]/route')).PATCH(req('PATCH', { role: 'petugas', layanan_id: LAY }), ctx());
    expect(res.status).toBe(200);
    expect(s.updates[0].values).toEqual({ role: 'petugas', layanan_id: LAY });
  });
  it('role petugas wajib layanan', async () => {
    await setup({ target: { ...TARGET, role: 'front_office', layanan_id: null } });
    const res = await (await import('./[id]/route')).PATCH(req('PATCH', { role: 'petugas' }), ctx());
    expect(res.status).toBe(400);
  });
  // ---- Audit T2d (No 69-71): UPDATE wajib baris, kompensasi & pengakhiran sesi tidak boleh gagal diam-diam ----
  it('UPDATE petugas 0 baris (akun hilang sejak dibaca) = 404, Auth tidak disentuh', async () => {
    const s = await setup({ updateResults: [{ data: [] }] });
    const res = await (await import('./[id]/route')).PATCH(req('PATCH', { username: 'baru-user' }), ctx());
    expect(res.status).toBe(404);
    expect(s.updateUserById).not.toHaveBeenCalled();
    expect(s.inserts).toHaveLength(0); // tidak ada audit "akun_ubah" palsu
  });

  it('galat DB lain pada UPDATE = 500 generik, tercatat, Auth tidak disentuh', async () => {
    const s = await setup({ updateError: { code: '57014', message: 'canceling statement rahasia-db' } });
    const res = await (await import('./[id]/route')).PATCH(req('PATCH', { nama: 'Baru' }), ctx());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('rahasia-db');
    expect(s.updateUserById).not.toHaveBeenCalled();
    expect(s.log).toHaveBeenCalledWith('error', expect.objectContaining({ operation: 'admin.petugas.ubah', asalCode: '57014' }));
  });

  it('sinkron Auth gagal DAN kompensasi username gagal: 502 tetap, pesan memperingatkan, tercatat sebagai error', async () => {
    const s = await setup({ authError: { message: 'boom' }, updateResults: [{ data: [{ id: ID }] }, { error: { code: '57014', message: 'timeout' } }] });
    const res = await (await import('./[id]/route')).PATCH(req('PATCH', { username: 'baru-user' }), ctx());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/username/i);
    expect(body.error).toMatch(/periksa/i);
    expect(s.log).toHaveBeenCalledWith('error', expect.objectContaining({ operation: 'admin.petugas.ubah.kompensasi_username', asalCode: '57014' }));
  });

  it('kompensasi username 0 baris juga dianggap gagal (username DB tidak kembali)', async () => {
    const s = await setup({ authError: { message: 'boom' }, updateResults: [{ data: [{ id: ID }] }, { data: [] }] });
    const res = await (await import('./[id]/route')).PATCH(req('PATCH', { username: 'baru-user' }), ctx());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/periksa/i);
    expect(s.log).toHaveBeenCalledWith('warn', expect.objectContaining({ operation: 'admin.petugas.ubah.kompensasi_username', kode: 'tidak_ada_baris' }));
  });

  it('akun_akhiri_sesi gagal setelah email login diganti: tetap 200 TAPI ada peringatan, audit sesi_diakhiri=false, tercatat', async () => {
    const s = await setup({ sesiError: { code: '42501', message: 'hanya service_role' } });
    const res = await (await import('./[id]/route')).PATCH(req('PATCH', { username: 'baru-user' }), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.peringatan).toMatch(/sesi/i);
    expect(s.inserts[0].values).toMatchObject({ aksi: 'akun_ubah', detail: { sesi_diakhiri: false, email_login_diganti: true } });
    expect(s.log).toHaveBeenCalledWith('error', expect.objectContaining({ operation: 'admin.petugas.ubah.akhiri_sesi', asalCode: '42501' }));
  });

  it('sukses penuh tidak membawa peringatan', async () => {
    const s = await setup();
    const body = await (await (await import('./[id]/route')).PATCH(req('PATCH', { username: 'baru-user' }), ctx())).json();
    expect(body).toEqual({ ok: true });
    expect(s.inserts[0].values).toMatchObject({ detail: { sesi_diakhiri: true } });
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
  // ---- Audit T2d (No 67-68): reset sandi adalah operasi pencabutan kredensial -> gagal-tutup ----
  it('penanda wajib_ganti_sandi gagal disimpan: 500, sandi sementara TIDAK dibocorkan, sesi tetap dicoba diakhiri, diaudit apa adanya', async () => {
    const s = await setup({ updateResults: [{ error: { code: '57014', message: 'timeout' } }] });
    const res = await (await import('./[id]/reset-password/route')).POST(req('POST'), ctx());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.sandi_sementara).toBeUndefined();
    expect(body.error).toMatch(/ulangi/i);
    expect(s.rpc).toHaveBeenCalledWith('akun_akhiri_sesi', { p_auth_user_id: 'auth-t' });
    expect(s.inserts[0].values).toMatchObject({ aksi: 'akun_reset_sandi', detail: { wajib_ganti_sandi: false, sesi_diakhiri: true } });
    expect(s.log).toHaveBeenCalledWith('error', expect.objectContaining({ operation: 'admin.petugas.reset_sandi.penanda', asalCode: '57014' }));
  });

  it('penanda 0 baris (akun hilang) juga gagal-tutup', async () => {
    const s = await setup({ updateResults: [{ data: [] }] });
    const res = await (await import('./[id]/reset-password/route')).POST(req('POST'), ctx());
    expect(res.status).toBe(500);
    expect((await res.json()).sandi_sementara).toBeUndefined();
    expect(s.log).toHaveBeenCalledWith('warn', expect.objectContaining({ operation: 'admin.petugas.reset_sandi.penanda', kode: 'tidak_ada_baris' }));
  });

  it('akun_akhiri_sesi gagal: 500 tanpa sandi (sesi lama masih hidup), audit sesi_diakhiri=false', async () => {
    const s = await setup({ sesiError: { message: 'gagal' } });
    const res = await (await import('./[id]/reset-password/route')).POST(req('POST'), ctx());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.sandi_sementara).toBeUndefined();
    expect(body.error).toMatch(/sesi/i);
    expect(s.inserts[0].values).toMatchObject({ aksi: 'akun_reset_sandi', detail: { wajib_ganti_sandi: true, sesi_diakhiri: false } });
    expect(s.log).toHaveBeenCalledWith('error', expect.objectContaining({ operation: 'admin.petugas.reset_sandi.akhiri_sesi' }));
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
