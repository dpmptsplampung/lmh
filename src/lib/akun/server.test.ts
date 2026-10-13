// @vitest-environment node
// Audit T2d (inventaris No 1-3): pembantu route akun. ambilJatah (rate limit) harus gagal-tutup bila kuota tidak
// bisa dicatat; audit best-effort tetapi tidak boleh gagal diam-diam; token verifikasi email memakai upsert berkunci petugas_id.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/observability/logger', () => ({ logServerEvent: vi.fn() }));

const resend = vi.hoisted(() => ({ send: vi.fn(async () => ({ error: null })) }));
vi.mock('resend', () => ({ Resend: class { emails = { send: resend.send }; } }));

type Galat = { code?: string; message: string } | null;

function fakeService(o: {
  count?: number;
  selectError?: Galat;
  insertError?: Galat;
  upsertError?: Galat;
  auditError?: Galat;
} = {}) {
  const insertJatah = vi.fn(async () => ({ error: o.insertError ?? null }));
  const insertAudit = vi.fn(async () => ({ error: o.auditError ?? null }));
  const upsert = vi.fn(async () => ({ error: o.upsertError ?? null }));
  const service = {
    from: (t: string) => {
      if (t === 'anon_rate_limit') {
        return {
          select: () => ({ eq: () => ({ gte: () => ({ is: async () => ({ count: o.count ?? 0, error: o.selectError ?? null }) }) }) }),
          insert: insertJatah,
        };
      }
      if (t === 'audit_log') return { insert: insertAudit };
      if (t === 'petugas_verif_email') return { upsert };
      throw new Error(`tabel tak terduga ${t}`);
    },
  } as unknown as SupabaseClient;
  return { service, insertJatah, insertAudit, upsert };
}

async function muat() {
  const mod = await import('./server');
  const logger = await import('@/lib/observability/logger');
  const log = vi.mocked(logger.logServerEvent);
  log.mockClear();
  return { ...mod, log };
}

describe('ambilJatah', () => {
  beforeEach(() => vi.resetModules());

  it('masih ada jatah: true dan pemakaian dicatat (user_id null + action)', async () => {
    const f = fakeService({ count: 1 });
    const { ambilJatah } = await muat();
    expect(await ambilJatah(f.service, 'akun:x', 3, 60)).toBe(true);
    expect(f.insertJatah).toHaveBeenCalledWith({ user_id: null, action: 'akun:x' });
  });

  it('jatah habis: false tanpa mencatat; galat membaca kuota: false (gagal-tutup)', async () => {
    let f = fakeService({ count: 3 });
    let m = await muat();
    expect(await m.ambilJatah(f.service, 'akun:x', 3, 60)).toBe(false);
    expect(f.insertJatah).not.toHaveBeenCalled();

    vi.resetModules();
    f = fakeService({ selectError: { code: '57014', message: 'timeout' } });
    m = await muat();
    expect(await m.ambilJatah(f.service, 'akun:x', 3, 60)).toBe(false);
    expect(f.insertJatah).not.toHaveBeenCalled();
  });

  it('pemakaian GAGAL dicatat -> false (gagal-tutup: kuota tak tercatat = batas bisa dilewati) dan tercatat di log', async () => {
    const f = fakeService({ count: 0, insertError: { code: '42501', message: 'row-level security' } });
    const m = await muat();
    expect(await m.ambilJatah(f.service, 'akun:x', 3, 60)).toBe(false);
    expect(m.log).toHaveBeenCalledWith('error', expect.objectContaining({ operation: 'akun.ambil_jatah.catat', asalCode: '42501' }));
  });
});

describe('audit', () => {
  beforeEach(() => vi.resetModules());

  it('sukses: menulis audit_log dengan pelaku, aksi, entitas petugas', async () => {
    const f = fakeService();
    const { audit } = await muat();
    await audit(f.service, { id: 'p-1', role: 'admin' }, 'akun_ubah', 'p-2', { kolom: ['nama'] });
    expect(f.insertAudit).toHaveBeenCalledWith({
      actor_id: 'p-1', actor_role: 'admin', aksi: 'akun_ubah', entitas: 'petugas', entitas_id: 'p-2', detail: { kolom: ['nama'] },
    });
  });

  it('gagal menulis: best-effort (tidak melempar) tetapi dicatat ke log terstruktur tanpa pesan DB', async () => {
    const f = fakeService({ auditError: { code: '23502', message: 'null value in column "aksi" rahasia' } });
    const m = await muat();
    await expect(m.audit(f.service, { id: 'p-1', role: 'admin' }, 'akun_ubah', 'p-2', {})).resolves.toBeUndefined();
    expect(m.log).toHaveBeenCalledWith('error', expect.objectContaining({ operation: 'akun.audit', asalCode: '23502' }));
    expect(JSON.stringify(m.log.mock.calls)).not.toContain('rahasia');
  });
});

describe('kirimVerifikasiEmail', () => {
  beforeEach(() => {
    vi.resetModules();
    resend.send.mockClear();
    process.env.NEXT_PUBLIC_PUBLIC_URL = 'https://lmh.example.go.id/';
    process.env.RESEND_API_KEY = 're_test';
  });

  it('tanpa NEXT_PUBLIC_PUBLIC_URL: false, tidak menyentuh DB', async () => {
    delete process.env.NEXT_PUBLIC_PUBLIC_URL;
    const f = fakeService();
    const m = await muat();
    expect(await m.kirimVerifikasiEmail(f.service, 'p-1', 'a@b.id')).toBe(false);
    expect(f.upsert).not.toHaveBeenCalled();
  });

  it('upsert token berkunci petugas_id (satu token aktif per petugas, PK) lalu mengirim tautan', async () => {
    const f = fakeService();
    const m = await muat();
    expect(await m.kirimVerifikasiEmail(f.service, 'p-1', 'a@b.id')).toBe(true);
    expect(f.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ petugas_id: 'p-1', email: 'a@b.id', token_hash: expect.stringMatching(/^[0-9a-f]{64}$/) }),
      { onConflict: 'petugas_id' },
    );
    expect(resend.send).toHaveBeenCalledTimes(1);
  });

  it('upsert token gagal: false, email TIDAK dikirim, kegagalan tercatat', async () => {
    const f = fakeService({ upsertError: { code: '23503', message: 'fk' } });
    const m = await muat();
    expect(await m.kirimVerifikasiEmail(f.service, 'p-1', 'a@b.id')).toBe(false);
    expect(resend.send).not.toHaveBeenCalled();
    expect(m.log).toHaveBeenCalledWith('error', expect.objectContaining({ operation: 'akun.verif_email.simpan_token', asalCode: '23503' }));
  });
});
