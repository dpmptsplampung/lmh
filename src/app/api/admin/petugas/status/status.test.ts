// @vitest-environment node
// RBAC Tahap 0 (S1/S11): nonaktifkan = Admin SAJA (FO ditolak), aktifkan kembali memakai RPC
// lewat service-role, admin NONAKTIF tidak dianggap aktor.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/observability/logger', () => ({ logServerEvent: vi.fn() }));

import type { NextRequest } from 'next/server';

const req = (body: unknown): NextRequest =>
  new Request('http://localhost/api/admin/petugas/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

const TARGET = '660e8400-e29b-41d4-a716-446655440001';

async function setup(opts: {
  user?: { id: string } | null;
  actor?: { id: string; role: string; aktif: boolean } | null;
  rpcError?: { message: string; code?: string } | null;
  /** Galat khusus RPC akun_akhiri_sesi (sesi aktif target gagal diakhiri). */
  sesiError?: { message: string; code?: string } | null;
  /** Galat INSERT notifikasi admin (RBA-08); INSERT audit_log tetap sukses. */
  notifError?: { message: string; code?: string } | null;
  banError?: { message: string } | null;
}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  const user = opts.user === undefined ? { id: 'auth-1' } : opts.user;
  const serverMod = await import('@/lib/supabase/server');
  (serverMod.createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: opts.actor ?? null }),
        }),
      }),
    }),
  });
  const rpc = vi.fn(async (nama: string) => ({
    error: nama === 'akun_akhiri_sesi' ? (opts.sesiError ?? opts.rpcError ?? null) : (opts.rpcError ?? null),
  }));
  // Baris notifikasi punya kunci 'kanal'; baris audit_log punya 'aksi'.
  const insert = vi.fn(async (v: Record<string, unknown>) => ({ error: 'kanal' in v ? (opts.notifError ?? null) : null }));
  const updateUserById = vi.fn().mockResolvedValue({ error: opts.banError ?? null });
  const sbMod = await import('@supabase/supabase-js');
  (sbMod.createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    rpc,
    auth: { admin: { updateUserById } },
    from: vi.fn().mockReturnValue({
      insert,
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { auth_user_id: 'auth-target' } }) }) }),
    }),
  });
  const logger = await import('@/lib/observability/logger');
  const log = vi.mocked(logger.logServerEvent);
  log.mockClear();
  return { rpc, insert, updateUserById, log };
}

describe('POST /api/admin/petugas/status', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('401 tanpa login', async () => {
    const { rpc } = await setup({ user: null });
    const { POST } = await import('./route');
    const res = await POST(req({ aksi: 'nonaktifkan', petugas_id: TARGET, alasan: 'x' }));
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('401 untuk admin NONAKTIF', async () => {
    const { rpc } = await setup({ actor: { id: 'p-1', role: 'admin', aktif: false } });
    const { POST } = await import('./route');
    const res = await POST(req({ aksi: 'nonaktifkan', petugas_id: TARGET, alasan: 'x' }));
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('FO TIDAK boleh menonaktifkan (403, RPC tidak dipanggil)', async () => {
    const { rpc } = await setup({ actor: { id: 'p-fo', role: 'front_office', aktif: true } });
    const { POST } = await import('./route');
    const res = await POST(req({ aksi: 'nonaktifkan', petugas_id: TARGET, alasan: 'x' }));
    expect(res.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('petugas biasa ditolak (403)', async () => {
    const { rpc } = await setup({ actor: { id: 'p-1', role: 'petugas', aktif: true } });
    const { POST } = await import('./route');
    const res = await POST(req({ aksi: 'nonaktifkan', petugas_id: TARGET, alasan: 'x' }));
    expect(res.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('alasan wajib (400)', async () => {
    await setup({ actor: { id: 'p-admin', role: 'admin', aktif: true } });
    const { POST } = await import('./route');
    const res = await POST(req({ aksi: 'nonaktifkan', petugas_id: TARGET, alasan: '  ' }));
    expect(res.status).toBe(400);
  });

  it('admin aktif menonaktifkan: RPC dipanggil dengan p_actor = id admin, notifikasi dicatat', async () => {
    const { rpc, insert, updateUserById } = await setup({ actor: { id: 'p-admin', role: 'admin', aktif: true } });
    const { POST } = await import('./route');
    const res = await POST(req({ aksi: 'nonaktifkan', petugas_id: TARGET, alasan: ' cuti ' }));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('petugas_set_nonaktif', {
      p_petugas_id: TARGET,
      p_alasan: 'cuti',
      p_actor: 'p-admin',
    });
    expect(insert).toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ aksi: 'akun_nonaktifkan', entitas_id: TARGET, actor_id: 'p-admin' }));
    // Tahap 2: blokir login di Auth + akhiri sesi
    expect(updateUserById).toHaveBeenCalledWith('auth-target', { ban_duration: '876000h' });
    expect(rpc).toHaveBeenCalledWith('akun_akhiri_sesi', { p_auth_user_id: 'auth-target' });
  });

  // ---- Audit T2d (No 74, 76, RBA-08): langkah keamanan & notifikasi tidak boleh gagal diam-diam ----
  it('akun_akhiri_sesi gagal: role sudah dicabut tetapi ada peringatan, audit sesi_diakhiri=false, tercatat', async () => {
    const s = await setup({ actor: { id: 'p-admin', role: 'admin', aktif: true }, sesiError: { message: 'gagal', code: 'XX000' } });
    const { POST } = await import('./route');
    const res = await POST(req({ aksi: 'nonaktifkan', petugas_id: TARGET, alasan: 'cuti' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.peringatan).toMatch(/sesi/i);
    expect(s.insert).toHaveBeenCalledWith(expect.objectContaining({ aksi: 'akun_nonaktifkan', detail: expect.objectContaining({ sesi_diakhiri: false }) }));
    expect(s.log).toHaveBeenCalledWith('error', expect.objectContaining({ operation: 'admin.petugas.status.akhiri_sesi', asalCode: 'XX000' }));
  });

  it('notifikasi admin (RBA-08) gagal disimpan: nonaktif tetap berhasil, tetapi tercatat, diaudit, dan ada peringatan', async () => {
    const s = await setup({ actor: { id: 'p-admin', role: 'admin', aktif: true }, notifError: { message: 'boom', code: '23502' } });
    const { POST } = await import('./route');
    const res = await POST(req({ aksi: 'nonaktifkan', petugas_id: TARGET, alasan: 'cuti' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.peringatan).toMatch(/notifikasi/i);
    expect(s.insert).toHaveBeenCalledWith(expect.objectContaining({ aksi: 'akun_nonaktifkan', detail: expect.objectContaining({ notifikasi_admin_gagal: true }) }));
    expect(s.log).toHaveBeenCalledWith('error', expect.objectContaining({ operation: 'admin.petugas.status.notifikasi', asalCode: '23502' }));
  });

  it('semua langkah sukses: tidak ada peringatan', async () => {
    await setup({ actor: { id: 'p-admin', role: 'admin', aktif: true } });
    const res = await (await import('./route')).POST(req({ aksi: 'nonaktifkan', petugas_id: TARGET, alasan: 'cuti' }));
    expect(await res.json()).toEqual({ ok: true });
  });

  it('blokir Auth (ban) gagal: sesi TIDAK diakhiri-ulang tanpa blokir, peringatan, dan kegagalan sesi tidak ikut dicatat ganda', async () => {
    const s = await setup({ actor: { id: 'p-admin', role: 'admin', aktif: true }, banError: { message: 'auth down' } });
    const res = await (await import('./route')).POST(req({ aksi: 'nonaktifkan', petugas_id: TARGET, alasan: 'cuti' }));
    const json = await res.json();
    expect(json.peringatan).toMatch(/blokir/i);
    expect(s.rpc).not.toHaveBeenCalledWith('akun_akhiri_sesi', expect.anything());
  });

  it('galat DB 42501 dipetakan ke 403, galat lain 400', async () => {
    await setup({ actor: { id: 'p-admin', role: 'admin', aktif: true }, rpcError: { message: 'x', code: '42501' } });
    let mod = await import('./route');
    expect((await mod.POST(req({ aksi: 'nonaktifkan', petugas_id: TARGET, alasan: 'a' }))).status).toBe(403);
    vi.resetModules();
    await setup({ actor: { id: 'p-admin', role: 'admin', aktif: true }, rpcError: { message: 'tidak boleh menonaktifkan akun sendiri' } });
    mod = await import('./route');
    expect((await mod.POST(req({ aksi: 'nonaktifkan', petugas_id: TARGET, alasan: 'a' }))).status).toBe(400);
  });

  it('galat RPC tak dikenal: 500 pesan baku (pesan DB TIDAK bocor ke klien), detail dicatat', async () => {
    const s = await setup({ actor: { id: 'p-admin', role: 'admin', aktif: true }, rpcError: { message: 'relation "petugas" secret-xyz does not exist', code: '42P01' } });
    const res = await (await import('./route')).POST(req({ aksi: 'nonaktifkan', petugas_id: TARGET, alasan: 'a' }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret-xyz');
    expect(s.log).toHaveBeenCalledWith('error', expect.objectContaining({ operation: 'admin.petugas.status.rpc', asalCode: '42P01' }));
    expect(JSON.stringify(s.log.mock.calls)).not.toContain('secret-xyz');
  });

  it('aturan bisnis DB dipetakan ke pesan baku Indonesia: admin terakhir / akun sendiri (400), tidak ditemukan (404), 42501 (403)', async () => {
    const kasus: Array<[{ message: string; code?: string }, number, RegExp]> = [
      [{ message: 'tidak boleh menonaktifkan Admin aktif terakhir' }, 400, /Admin aktif terakhir/i],
      [{ message: 'tidak boleh menonaktifkan akun sendiri' }, 400, /akun sendiri/i],
      [{ message: 'petugas tidak ditemukan', code: 'P0002' }, 404, /tidak ditemukan/i],
      [{ message: 'hanya Admin aktif yang boleh menonaktifkan akun', code: '42501' }, 403, /berwenang|Admin/i],
    ];
    for (const [rpcError, status, pola] of kasus) {
      vi.resetModules();
      await setup({ actor: { id: 'p-admin', role: 'admin', aktif: true }, rpcError });
      const res = await (await import('./route')).POST(req({ aksi: 'nonaktifkan', petugas_id: TARGET, alasan: 'a' }));
      expect(res.status, rpcError.message).toBe(status);
      expect((await res.json()).error).toMatch(pola);
    }
  });

  it('aktifkan: galat RPC tak dikenal juga 500 pesan baku', async () => {
    await setup({ actor: { id: 'p-admin', role: 'admin', aktif: true }, rpcError: { message: 'connection to server secret-abc lost', code: '08006' } });
    const res = await (await import('./route')).POST(req({ aksi: 'aktifkan', petugas_id: TARGET }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret-abc');
  });

  it('aktifkan kembali: hanya admin; RPC petugas_set_aktif lewat service-role', async () => {
    const fo = await setup({ actor: { id: 'p-fo', role: 'front_office', aktif: true } });
    let mod = await import('./route');
    expect((await mod.POST(req({ aksi: 'aktifkan', petugas_id: TARGET }))).status).toBe(403);
    expect(fo.rpc).not.toHaveBeenCalled();

    vi.resetModules();
    const adm = await setup({ actor: { id: 'p-admin', role: 'admin', aktif: true } });
    mod = await import('./route');
    const res = await mod.POST(req({ aksi: 'aktifkan', petugas_id: TARGET }));
    expect(res.status).toBe(200);
    expect(adm.rpc).toHaveBeenCalledWith('petugas_set_aktif', { p_petugas_id: TARGET });
    expect(adm.updateUserById).toHaveBeenCalledWith('auth-target', { ban_duration: 'none' });
    expect(adm.insert).toHaveBeenCalledWith(expect.objectContaining({ aksi: 'akun_aktifkan', entitas_id: TARGET }));
  });

  it('ganti_pic dihapus: 410 dan tidak ada panggilan Auth', async () => {
    const adm = await setup({ actor: { id: 'p-admin', role: 'admin', aktif: true } });
    const mod = await import('./route');
    const res = await mod.POST(req({ aksi: 'ganti_pic', petugas_id: TARGET, email_baru: 'x@y.id' }));
    expect(res.status).toBe(410);
    expect(adm.updateUserById).not.toHaveBeenCalled();
    expect(adm.rpc).not.toHaveBeenCalled();
  });
});
