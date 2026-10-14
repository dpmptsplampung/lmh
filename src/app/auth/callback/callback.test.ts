// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  exchange: vi.fn(),
  rpc: vi.fn(),
  signOut: vi.fn(),
  peran: null as { role: string } | null,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { exchangeCodeForSession: h.exchange, signOut: h.signOut },
    rpc: h.rpc,
    from: (tabel: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: tabel === 'petugas' ? h.peran : null, error: null }),
          single: () => Promise.resolve({ data: { id: 'p1' }, error: null }),
        }),
      }),
    }),
  }),
}));

import { GET } from './route';

const panggil = (qs: string) => GET(new Request(`http://localhost/auth/callback?${qs}`));

describe('auth callback: sesi tunggal staf', () => {
  beforeEach(() => {
    // Test lain (invite, request-edit-link) mengisi env ini tanpa membersihkan; di vmForks bisa bocor antar berkas.
    vi.stubEnv('NEXT_PUBLIC_PUBLIC_URL', '');
    h.exchange.mockReset().mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.c', user_metadata: {} } }, error: null });
    h.rpc.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
    h.signOut.mockReset().mockResolvedValue({ error: null });
    h.peran = null;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('staf: daftarkan_sesi sekali lalu lanjut ke tujuan', async () => {
    h.peran = { role: 'admin' };
    const res = await panggil('code=abc&next=/admin');
    expect(h.rpc.mock.calls.filter((c) => c[0] === 'daftarkan_sesi')).toHaveLength(1);
    expect(res.headers.get('location')).toBe('http://localhost/admin');
  });

  it('pengunjung/mitra non-staf: TIDAK memanggil daftarkan_sesi', async () => {
    h.peran = null;
    const res = await panggil('code=abc');
    expect(h.rpc).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toBe('http://localhost/me');
  });

  it('staf dengan pendaftaran gagal: keluar lokal dan alihkan ke /login?error=sesi', async () => {
    h.peran = { role: 'petugas' };
    h.rpc.mockResolvedValue({ data: null, error: { message: 'SESI_TANPA_KLAIM: x', code: '22023' } });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await panggil('code=abc&next=/admin');
    expect(res.headers.get('location')).toBe('http://localhost/login?error=sesi');
    expect(h.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('FORBIDDEN dari RPC (petugas nonaktif) tidak menghalangi login', async () => {
    h.peran = { role: 'petugas' };
    h.rpc.mockResolvedValue({ data: null, error: { message: 'FORBIDDEN: x', code: '42501' } });
    const res = await panggil('code=abc&next=/me');
    expect(res.headers.get('location')).toBe('http://localhost/me');
  });
});
