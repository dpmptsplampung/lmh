// @vitest-pool forks
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(),
}));

import type { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

interface PetugasRow {
  role?: string | null;
  wajib_ganti_sandi?: boolean;
}

interface MockUser {
  id: string;
  app_metadata?: { role?: string } | null;
}

interface ClientOpts {
  user: MockUser | null;
  petugasRow?: PetugasRow | null;
  authFailure?: Error;
  roleFailure?: Error;
  // Balasan RPC sesi_status (bawaan 'ok'); sesiError = RPC mengembalikan { error }; sesiRejects = RPC menolak (jaringan).
  sesiStatus?: unknown;
  sesiError?: { message: string };
  sesiRejects?: Error;
  sesiHang?: boolean;
  // Balasan RPC staf_modul (bawaan null); modulError = RPC mengembalikan { error }.
  modul?: unknown;
  modulError?: { message: string };
}

const buildRequest = (url: string, headers?: HeadersInit): NextRequest => {
  const req = new Request(url, { method: 'GET', headers });
  (req as unknown as { nextUrl: URL }).nextUrl = new URL(url);
  return req as unknown as NextRequest;
};

const expectRequestId = (response: Response) => {
  expect(response.headers.get('x-request-id')).toMatch(/^[A-Za-z0-9._:-]{1,128}$/);
};

describe('proxy — request ID propagation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    setEnv();
  });

  it('preserves a valid incoming ID in forwarded and response headers', async () => {
    await mockCreateServerClient({ user: null });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/', { 'x-request-id': 'upstream_123-abc' }));
    expect(res.headers.get('x-request-id')).toBe('upstream_123-abc');
    expect(res.headers.get('x-middleware-request-x-request-id')).toBe('upstream_123-abc');
  });

  it.each(['contains spaces', 'a'.repeat(129), 'bad/header'])('replaces invalid incoming ID %s', async (incoming) => {
    await mockCreateServerClient({ user: null });
    const randomUUID = vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000000');
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/', { 'x-request-id': incoming }));
    expect(res.headers.get('x-request-id')).toBe('00000000-0000-4000-8000-000000000000');
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it('adds the request ID to auth redirects without changing redirect behavior', async () => {
    await mockCreateServerClient({ user: null });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/admin', { 'x-request-id': 'req.admin:1' }));
    expect(res.headers.get('location')).toMatch(/\/login/);
    expect(res.headers.get('x-request-id')).toBe('req.admin:1');
  });
});

const mockCreateServerClient = async ({
  user, petugasRow, authFailure, roleFailure, sesiStatus = 'ok', sesiError, sesiRejects, sesiHang, modul = null, modulError,
}: ClientOpts) => {
  const ssrMod = await import('@supabase/ssr');
  const createServerClient = ssrMod.createServerClient as unknown as Mock;

  const fromChain = {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockImplementation(() => roleFailure
          ? Promise.reject(roleFailure)
          : Promise.resolve({ data: petugasRow ?? null, error: null })),
      }),
    }),
  };

  const mockClient = {
    auth: {
      getUser: vi.fn().mockImplementation(() => authFailure
        ? Promise.reject(authFailure)
        : Promise.resolve({ data: { user }, error: null })),
    },
    from: vi.fn().mockReturnValue(fromChain),
    rpc: vi.fn().mockImplementation((nama: string) => {
      if (nama === 'staf_modul') {
        return Promise.resolve(modulError ? { data: null, error: modulError } : { data: modul, error: null });
      }
      if (sesiHang) return new Promise(() => undefined);
      if (sesiRejects) return Promise.reject(sesiRejects);
      return Promise.resolve(sesiError ? { data: null, error: sesiError } : { data: sesiStatus, error: null });
    }),
  };

  createServerClient.mockReturnValue(mockClient);
  return { mockClient, fromChain };
};

const setEnv = () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
};

describe('proxy — non-protected routes', () => {
  beforeEach(() => {
    vi.resetModules();
    setEnv();
  });

  it('passes through non-protected route (e.g. /) without auth check', async () => {
    const { mockClient } = await mockCreateServerClient({ user: null });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/'));
    expect(res.status).toBe(200);
    expectRequestId(res);
    expect(mockClient.auth.getUser).not.toHaveBeenCalled();
  });
});

describe('proxy — unauthenticated access to protected routes', () => {
  beforeEach(() => {
    vi.resetModules();
    setEnv();
  });

  it('redirects to /login?redirect=... when no user accesses /admin', async () => {
    const { mockClient } = await mockCreateServerClient({ user: null });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/admin'));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get('location')).toMatch(/\/login/);
    expect(res.headers.get('location')).toMatch(/redirect=/);
    expectRequestId(res);
    expect(mockClient.from).not.toHaveBeenCalled();
  });
});

describe('proxy — bounded failures', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    setEnv();
  });

  it('contains rejected auth calls with structured logging and request ID', async () => {
    await mockCreateServerClient({ user: null, authFailure: new Error('token=auth-secret') });
    const write = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { proxy } = await import('./proxy');
    const response = await proxy(buildRequest('http://localhost/admin', { 'x-request-id': 'req-auth' }));
    expect(response.status).toBe(500);
    expect(response.headers.get('x-request-id')).toBe('req-auth');
    expect(await response.text()).toBe('{"error":"Internal server error"}');
    expect(JSON.parse(String(write.mock.calls[0][0]))).toMatchObject({ operation: 'proxy.failure', requestId: 'req-auth' });
    expect(String(write.mock.calls[0][0])).not.toContain('auth-secret');
  });

  it('contains rejected role queries with a bounded JSON response', async () => {
    await mockCreateServerClient({
      user: { id: 'u-1', app_metadata: null }, roleFailure: new Error('postgres private detail'),
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { proxy } = await import('./proxy');
    const response = await proxy(buildRequest('http://localhost/admin', { 'x-request-id': 'req-role' }));
    expect(response.status).toBe(500);
    expect(response.headers.get('x-request-id')).toBe('req-role');
    expect(await response.text()).toBe('{"error":"Internal server error"}');
  });

  it('uses structured logging for missing proxy configuration', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const write = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { proxy } = await import('./proxy');
    const response = await proxy(buildRequest('http://localhost/me', { 'x-request-id': 'req-config' }));
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('x-request-id')).toBe('req-config');
    expect(JSON.parse(String(write.mock.calls[0][0]))).toMatchObject({
      operation: 'proxy.failure',
      error: { type: 'ConfigurationError' },
    });
  });

  it('contains Supabase client construction exceptions', async () => {
    const ssrMod = await import('@supabase/ssr');
    (ssrMod.createServerClient as unknown as Mock).mockImplementationOnce(() => {
      throw new Error('client secret detail');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { proxy } = await import('./proxy');
    const response = await proxy(buildRequest('http://localhost/me', { 'x-request-id': 'req-client' }));
    expect(response.status).toBe(500);
    expect(response.headers.get('x-request-id')).toBe('req-client');
    expect(await response.text()).toBe('{"error":"Internal server error"}');
  });
});

describe('proxy — /admin with JWT app_metadata.role (no role DB query)', () => {
  beforeEach(() => {
    vi.resetModules();
    setEnv();
  });

  it('passes when app_metadata.role = admin (no DB query)', async () => {
    const { mockClient } = await mockCreateServerClient({
      user: { id: 'u-1', app_metadata: { role: 'admin' } },
    });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/admin'));
    expect(res.status).toBe(200);
    expectRequestId(res);
    expect(mockClient.from).toHaveBeenCalledTimes(1); // hanya cek wajib_ganti_sandi
  });

  it('passes when app_metadata.role = petugas (no DB query)', async () => {
    const { mockClient } = await mockCreateServerClient({
      user: { id: 'u-1', app_metadata: { role: 'petugas' } },
    });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/petugas/antrean'));
    expect(res.status).toBe(200);
    expectRequestId(res);
    expect(mockClient.from).toHaveBeenCalledTimes(1);
  });

  it('memaksa halaman profil peran ?ganti=1 bila wajib_ganti_sandi, kecuali di halaman profil itu', async () => {
    const m = await mockCreateServerClient({
      user: { id: 'u-1', app_metadata: { role: 'petugas' } },
      petugasRow: { wajib_ganti_sandi: true },
    });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/petugas/antrean'));
    expect(res.headers.get('location')).toBe('http://localhost/petugas/profil?ganti=1');
    m.mockClient.from.mockClear();
    const ok = await proxy(buildRequest('http://localhost/petugas/profil'));
    expect(ok.status).toBe(200);
    expect(m.mockClient.from).not.toHaveBeenCalled();
  });

  it('admin dan Front Office tetap dipaksa ke /admin/profil?ganti=1', async () => {
    for (const role of ['admin', 'front_office']) {
      vi.resetModules();
      const m = await mockCreateServerClient({
        user: { id: 'u-1', app_metadata: { role } },
        petugasRow: { wajib_ganti_sandi: true },
      });
      const { proxy } = await import('./proxy');
      const res = await proxy(buildRequest('http://localhost/admin/antrian'));
      expect(res.headers.get('location'), role).toBe('http://localhost/admin/profil?ganti=1');
      m.mockClient.from.mockClear();
      const ok = await proxy(buildRequest('http://localhost/admin/profil'));
      expect(ok.status, role).toBe(200);
      expect(m.mockClient.from).not.toHaveBeenCalled();
    }
  });

  it('redirects to /me when app_metadata.role = pengunjung (no DB query)', async () => {
    const { mockClient } = await mockCreateServerClient({
      user: { id: 'u-1', app_metadata: { role: 'pengunjung' } },
    });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/admin'));
    expect(res.headers.get('location')).toMatch(/\/me/);
    expectRequestId(res);
    expect(mockClient.from).not.toHaveBeenCalled();
  });
});

describe('proxy — /admin without app_metadata.role (fallback to DB query)', () => {
  beforeEach(() => {
    vi.resetModules();
    setEnv();
  });

  it('passes when DB returns role=admin (fallback engaged)', async () => {
    const { mockClient } = await mockCreateServerClient({
      user: { id: 'u-1', app_metadata: null },
      petugasRow: { role: 'admin' },
    });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/admin'));
    expect(res.status).toBe(200);
    expectRequestId(res);
    expect(mockClient.from).toHaveBeenCalledWith('petugas');
  });

  it('redirects to /me when DB returns null (fallback engaged)', async () => {
    const { mockClient } = await mockCreateServerClient({
      user: { id: 'u-1', app_metadata: null },
      petugasRow: null,
    });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/admin'));
    expect(res.headers.get('location')).toMatch(/\/me/);
    expectRequestId(res);
    expect(mockClient.from).toHaveBeenCalledWith('petugas');
  });
});

describe('proxy — /me route (no role check)', () => {
  beforeEach(() => {
    vi.resetModules();
    setEnv();
  });

  it('passes for any logged-in user without role check', async () => {
    const { mockClient } = await mockCreateServerClient({
      user: { id: 'u-1', app_metadata: { role: 'pengunjung' } },
    });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/me'));
    expect(res.status).toBe(200);
    expectRequestId(res);
    expect(mockClient.from).not.toHaveBeenCalled();
  });
});

describe('proxy — sesi tunggal staf (/petugas)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    setEnv();
  });

  const staf = { id: 'u-1', app_metadata: { role: 'petugas' } };

  it.each(['ok', 'transisi', 'bukan_staf'])('status %s melanjutkan halaman dan memanggil sesi_status sekali', async (sesiStatus) => {
    const { mockClient } = await mockCreateServerClient({ user: staf, sesiStatus });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/petugas/antrean'));
    expect(res.status).toBe(200);
    expect(mockClient.rpc).toHaveBeenCalledTimes(1);
    expect(mockClient.rpc).toHaveBeenCalledWith('sesi_status');
  });

  it.each(['digantikan', 'idle', 'tidak_terdaftar'])('status %s dialihkan ke /login dengan alasan yang sama', async (sesiStatus) => {
    await mockCreateServerClient({ user: staf, sesiStatus });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/petugas/antrean', { 'x-request-id': 'req-sesi' }));
    expect(res.headers.get('location')).toBe(`http://localhost/login?alasan=${sesiStatus}`);
    expectRequestId(res);
  });

  it('sesi tak sah menang atas paksaan ganti sandi (cek sesi mendahului)', async () => {
    await mockCreateServerClient({ user: staf, sesiStatus: 'digantikan', petugasRow: { wajib_ganti_sandi: true } });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/petugas/antrean'));
    expect(res.headers.get('location')).toMatch(/alasan=digantikan/);
  });

  it('tidak memanggil sesi_status untuk non-staf (dialihkan ke /me) maupun /me', async () => {
    const a = await mockCreateServerClient({ user: { id: 'u-2', app_metadata: { role: 'pengunjung' } } });
    const { proxy } = await import('./proxy');
    await proxy(buildRequest('http://localhost/admin'));
    await proxy(buildRequest('http://localhost/me'));
    expect(a.mockClient.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['RPC mengembalikan error', { sesiError: { message: 'function sesi_status does not exist' } }],
    ['RPC menolak (jaringan)', { sesiRejects: new Error('fetch failed') }],
    ['status di luar kontrak', { sesiStatus: 'aneh' }],
    ['balasan kosong', { sesiStatus: null }],
  ] as const)('gagal-terbuka dan dicatat bila %s', async (_nama, opsi) => {
    await mockCreateServerClient({ user: staf, ...opsi });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/petugas/antrean'));
    expect(res.status).toBe(200);
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({ operation: 'proxy.sesi_status_gagal' });
  });

  it('gagal-terbuka bila RPC menggantung melewati batas waktu', async () => {
    vi.useFakeTimers();
    try {
      await mockCreateServerClient({ user: staf, sesiHang: true });
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { proxy } = await import('./proxy');
      const pending = proxy(buildRequest('http://localhost/petugas/antrean'));
      await vi.advanceTimersByTimeAsync(3000);
      expect((await pending).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// G4: area per peran (/admin untuk admin dan Front Office, /petugas untuk Petugas Layanan)
// ---------------------------------------------------------------------------

const lokasi = (res: Response) => res.headers.get('location');
const penggunaDenganRole = (role: string) => ({ id: 'u-1', app_metadata: { role } });

describe('proxy — petugas yang membuka /admin/* dialihkan ke /petugas/*', () => {
  beforeEach(() => {
    vi.resetModules();
    setEnv();
  });

  it.each([
    ['/admin/antrian', '/petugas/antrean'],
    ['/admin/absensi', '/petugas/absensi'],
    ['/admin/chat', '/petugas/chat'],
    ['/admin/chat/faq', '/petugas/chat/faq'],
    ['/admin/rekap', '/petugas/rekap'],
    ['/admin/profil', '/petugas/profil'],
    ['/admin/umkm-tugas', '/petugas/umkm/tugas'],
    ['/admin/umkm-laporan', '/petugas/umkm/laporan'],
  ])('%s -> %s (padanan ada)', async (dari, ke) => {
    const m = await mockCreateServerClient({ user: penggunaDenganRole('petugas') });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest(`http://localhost${dari}`));
    expect(res.status).toBe(307);
    expect(lokasi(res)).toBe(`http://localhost${ke}`);
    expectRequestId(res);
    expect(m.mockClient.rpc).not.toHaveBeenCalled(); // pengalihan murni, tanpa cek sesi/modul
  });

  it('query string ikut (tautan notifikasi lama)', async () => {
    await mockCreateServerClient({ user: penggunaDenganRole('petugas') });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/admin/chat?sesi=abc&x=1'));
    expect(lokasi(res)).toBe('http://localhost/petugas/chat?sesi=abc&x=1');
  });

  it.each(['/admin', '/admin/kunjungan', '/admin/fo/registrasi', '/admin/settings', '/admin/chat/ai-log', '/admin/pengaduan', '/admin/halaman-baru'])(
    '%s tanpa padanan -> /petugas/antrean',
    async (dari) => {
      await mockCreateServerClient({ user: penggunaDenganRole('petugas') });
      const { proxy } = await import('./proxy');
      const res = await proxy(buildRequest(`http://localhost${dari}`));
      expect(lokasi(res)).toBe('http://localhost/petugas/antrean');
    },
  );

  it('role dari fallback DB (tanpa klaim JWT) diperlakukan sama', async () => {
    await mockCreateServerClient({ user: { id: 'u-1', app_metadata: null }, petugasRow: { role: 'petugas' } });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/admin/antrian'));
    expect(lokasi(res)).toBe('http://localhost/petugas/antrean');
  });
});

describe('proxy — admin dan Front Office di /petugas/*', () => {
  beforeEach(() => {
    vi.resetModules();
    setEnv();
  });

  it.each(['admin', 'front_office'])('%s dialihkan ke /admin', async (role) => {
    const m = await mockCreateServerClient({ user: penggunaDenganRole(role) });
    const { proxy } = await import('./proxy');
    for (const path of ['/petugas', '/petugas/antrean', '/petugas/umkm/tugas']) {
      const res = await proxy(buildRequest(`http://localhost${path}`));
      expect(res.status, path).toBe(307);
      expect(lokasi(res), path).toBe('http://localhost/admin');
    }
    expect(m.mockClient.rpc).not.toHaveBeenCalled();
  });

  it('role selain staf (pengunjung) ditolak ke /me, tanpa cek sesi', async () => {
    const m = await mockCreateServerClient({ user: penggunaDenganRole('pengunjung') });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/petugas/antrean'));
    expect(lokasi(res)).toBe('http://localhost/me');
    expect(m.mockClient.rpc).not.toHaveBeenCalled();
  });

  it('tanpa login: /login?redirect=/petugas/antrean', async () => {
    const m = await mockCreateServerClient({ user: null });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/petugas/antrean'));
    expect(lokasi(res)).toBe('http://localhost/login?redirect=%2Fpetugas%2Fantrean');
    expect(m.mockClient.from).not.toHaveBeenCalled();
  });
});

describe('proxy — otorisasi halaman di server (fail-closed)', () => {
  beforeEach(() => {
    vi.resetModules();
    setEnv();
  });

  it.each(['/petugas', '/petugas/antrean', '/petugas/absensi', '/petugas/chat', '/petugas/chat/faq', '/petugas/rekap', '/petugas/profil'])(
    'petugas boleh membuka %s tanpa membaca modul',
    async (path) => {
      const m = await mockCreateServerClient({ user: penggunaDenganRole('petugas') });
      const { proxy } = await import('./proxy');
      const res = await proxy(buildRequest(`http://localhost${path}`));
      expect(res.status).toBe(200);
      expect(m.mockClient.rpc).not.toHaveBeenCalledWith('staf_modul');
    },
  );

  it.each(['/petugas/halaman-baru', '/petugas/pengaduan', '/petugas/pesan-perilaku', '/petugas/settings/jadwal'])(
    'petugas di rute /petugas tak terdaftar %s -> /petugas/antrean',
    async (path) => {
      await mockCreateServerClient({ user: penggunaDenganRole('petugas') });
      const { proxy } = await import('./proxy');
      const res = await proxy(buildRequest(`http://localhost${path}`));
      expect(lokasi(res)).toBe('http://localhost/petugas/antrean');
    },
  );

  it.each(['/petugas/umkm/tugas', '/petugas/umkm/laporan'])('petugas bermodul umkm boleh membuka %s (staf_modul dipanggil)', async (path) => {
    const m = await mockCreateServerClient({ user: penggunaDenganRole('petugas'), modul: 'umkm' });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest(`http://localhost${path}`));
    expect(res.status).toBe(200);
    expect(m.mockClient.rpc).toHaveBeenCalledWith('staf_modul');
  });

  it.each([
    ['tanpa modul', { modul: null }],
    ['modul investasi', { modul: 'investasi' }],
    ['nilai asing', { modul: 'lain' }],
    ['RPC galat (migrasi belum diterapkan)', { modulError: { message: 'function staf_modul does not exist' } }],
  ] as const)('petugas %s ditolak di /petugas/umkm/tugas -> /petugas/antrean', async (_nama, opsi) => {
    await mockCreateServerClient({ user: penggunaDenganRole('petugas'), ...opsi });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/petugas/umkm/tugas'));
    expect(res.status).toBe(307);
    expect(lokasi(res)).toBe('http://localhost/petugas/antrean');
  });

  it('FO ditolak di halaman admin-saja dan rute /admin tak terdaftar; boleh di halaman FO', async () => {
    await mockCreateServerClient({ user: penggunaDenganRole('front_office') });
    const { proxy } = await import('./proxy');
    for (const path of ['/admin/petugas', '/admin/settings', '/admin/umkm-tugas', '/admin/halaman-baru']) {
      const res = await proxy(buildRequest(`http://localhost${path}`));
      expect(lokasi(res), path).toBe('http://localhost/admin/antrian');
    }
    for (const path of ['/admin', '/admin/fo/registrasi', '/admin/antrian', '/admin/rekap']) {
      expect((await proxy(buildRequest(`http://localhost${path}`))).status, path).toBe(200);
    }
  });

  it('admin boleh membuka semua halaman /admin, termasuk yang tak terdaftar dan tugas UMKM tanpa modul', async () => {
    await mockCreateServerClient({ user: penggunaDenganRole('admin') });
    const { proxy } = await import('./proxy');
    for (const path of ['/admin', '/admin/petugas', '/admin/umkm-tugas', '/admin/halaman-baru']) {
      expect((await proxy(buildRequest(`http://localhost${path}`))).status, path).toBe(200);
    }
  });

  it('sesi tak sah di /petugas dialihkan ke login sebelum otorisasi halaman', async () => {
    await mockCreateServerClient({ user: penggunaDenganRole('petugas'), sesiStatus: 'digantikan' });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/petugas/umkm/tugas'));
    expect(lokasi(res)).toBe('http://localhost/login?alasan=digantikan');
  });
});
