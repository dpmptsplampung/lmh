import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Fase 5: riwayat percakapan lintas sesi + lingkup staf lewat RPC boleh_chat_sesi (JWT pengguna) + email implisit.
const serverState = vi.hoisted(() => ({
  callerId: 'auth-1' as string | null,
  rpc: vi.fn(),
  // Tabel via klien berJWT pengguna (RLS): dipakai untuk riwayat staf tanpa izin lintas sesi (A1).
  from: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: serverState.callerId ? { id: serverState.callerId } : null }, error: null })),
    },
    rpc: serverState.rpc,
    from: (t: string) => serverState.from(t),
  })),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

import { createClient } from '@supabase/supabase-js';

const SESI = '123e4567-e89b-12d3-a456-426614174000';
const LAYANAN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PENGUNJUNG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

type Actor = { kind: 'staff'; role: 'admin' | 'petugas' | 'front_office'; layanan_id: string | null } | { kind: 'pengunjung' };

function chainRiwayat(rows: unknown[], galat: unknown = null) {
  const b: Record<string, unknown> = {};
  const catat: Array<[string, unknown[]]> = [];
  for (const m of ['select', 'eq', 'neq', 'lt', 'order']) {
    b[m] = (...a: unknown[]) => {
      catat.push([m, a]);
      return b;
    };
  }
  b.limit = (...a: unknown[]) => {
    catat.push(['limit', a]);
    return Promise.resolve({ data: rows, error: galat });
  };
  return { b, catat };
}

function mockAdmin(opts: {
  actor: Actor;
  sesiStatus?: string;
  riwayat?: unknown[];
  riwayatGalat?: unknown;
  terbuka?: Array<{ id: string }>;
  insert?: unknown;
}) {
  const riwayat = chainRiwayat(opts.riwayat ?? [], opts.riwayatGalat ?? null);
  const sesiTerbuka = chainRiwayat(opts.terbuka ?? []);
  const admin = {
    from: vi.fn((table: string) => {
      if (table === 'petugas') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: opts.actor.kind === 'staff' ? { id: 'pt-1', role: opts.actor.role, layanan_id: opts.actor.layanan_id, aktif: true } : null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'pengunjung') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.actor.kind === 'pengunjung' ? { id: PENGUNJUNG } : null, error: null }) }) }),
        };
      }
      if (table === 'chat_sesi') {
        // satu panggilan: lookup sesi (maybeSingle), lainnya: sesi terbuka (limit)
        const lookup = {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: SESI, status: opts.sesiStatus ?? 'bot', pengunjung_id: PENGUNJUNG, layanan_id: LAYANAN, ditangani_oleh: 'pt-1' },
                error: null,
              }),
              eq: sesiTerbuka.b.eq,
            }),
          }),
        };
        const kedua = sesiTerbuka.b as { select: (...x: unknown[]) => unknown };
        return { select: (...a: unknown[]) => (a[0] === 'id' ? kedua.select(...a) : lookup.select()) };
      }
      if (table === 'chat_pesan') {
        return {
          select: (...a: unknown[]) => (riwayat.b.select as (...x: unknown[]) => unknown)(...a),
          insert: () => ({
            select: () => ({
              single: async () => opts.insert ?? { data: { id: 'm9', pengirim: 'pengunjung', isi: 'Halo', created_at: '2026-10-31T01:00:00Z' }, error: null },
            }),
          }),
        };
      }
      return {};
    }),
  };
  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(admin);
  return { admin, riwayat };
}

const get = async (q: string) => {
  const { GET } = await import('./route');
  return GET(new NextRequest(new URL(`http://localhost/api/chat/messages${q}`)));
};
const post = async (body: unknown) => {
  const { POST } = await import('./route');
  return POST(
    new NextRequest(new URL('http://localhost/api/chat/messages'), {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
  );
};

const barisRiwayat = (id: string, sesi: string, iso: string) => ({
  id, sesi_id: sesi, pengirim: 'pengunjung', isi: id, created_at: iso, client_uuid: null, jenis_jawaban: null,
  chat_sesi: { pengunjung_id: PENGUNJUNG, layanan_id: LAYANAN },
});

describe('GET /api/chat/messages?riwayat=1', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    serverState.callerId = 'auth-1';
    serverState.rpc = vi.fn();
    serverState.from = vi.fn();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  });

  it('pengunjung pemilik: pesan lintas sesi urut naik dengan sesi_id, tanpa kolom gabungan, plus sesi terbuka', async () => {
    mockAdmin({
      actor: { kind: 'pengunjung' },
      // diminta menurun dari DB, harus dibalik menjadi naik
      riwayat: [barisRiwayat('m3', 'sesi-2', '2026-10-30T02:00:00Z'), barisRiwayat('m2', 'sesi-2', '2026-10-30T01:00:00Z'), barisRiwayat('m1', 'sesi-1', '2026-10-01T01:00:00Z')],
      terbuka: [{ id: 'sesi-2' }],
    });
    const res = await get(`?sesi_id=${SESI}&riwayat=1`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.messages.map((m: { id: string }) => m.id)).toEqual(['m1', 'm2', 'm3']);
    expect(json.messages.map((m: { sesi_id: string }) => m.sesi_id)).toEqual(['sesi-1', 'sesi-2', 'sesi-2']);
    expect(json.messages[0]).not.toHaveProperty('chat_sesi');
    expect(json.ada_lebih).toBe(false);
    expect(json.sesi_terbuka_id).toBe('sesi-2');
    expect(serverState.rpc).not.toHaveBeenCalled(); // pengunjung tidak memakai RPC lingkup staf
  });

  it('kueri memfilter pengunjung + Layanan sesi jangkar dan menerapkan sebelum/limit; ada_lebih bila baris > limit', async () => {
    const { riwayat } = mockAdmin({
      actor: { kind: 'pengunjung' },
      riwayat: [barisRiwayat('m3', 's', '2026-10-30T03:00:00Z'), barisRiwayat('m2', 's', '2026-10-30T02:00:00Z'), barisRiwayat('m1', 's', '2026-10-30T01:00:00Z')],
    });
    const res = await get(`?sesi_id=${SESI}&riwayat=1&limit=2&sebelum=2026-10-31T00:00:00Z`);
    const json = await res.json();
    expect(json.messages.map((m: { id: string }) => m.id)).toEqual(['m2', 'm3']);
    expect(json.ada_lebih).toBe(true);
    const filter = riwayat.catat.filter(([m]) => m === 'eq').map(([, a]) => a);
    expect(filter).toContainEqual(['chat_sesi.pengunjung_id', PENGUNJUNG]);
    expect(filter).toContainEqual(['chat_sesi.layanan_id', LAYANAN]);
    expect(riwayat.catat).toContainEqual(['lt', ['created_at', '2026-10-31T00:00:00Z']]);
    expect(riwayat.catat).toContainEqual(['limit', [3]]);
  });

  it('parameter tidak valid: sebelum bukan tanggal -> 400', async () => {
    mockAdmin({ actor: { kind: 'pengunjung' } });
    expect((await get(`?sesi_id=${SESI}&riwayat=1&sebelum=kemarin`)).status).toBe(400);
  });

  it('staf: RPC boleh_chat_sesi dipanggil dengan JWT pengguna; false -> 403 walau Layanan sama (FO biasa/tertutup)', async () => {
    mockAdmin({ actor: { kind: 'staff', role: 'front_office', layanan_id: null }, sesiStatus: 'selesai' });
    serverState.rpc.mockResolvedValue({ data: false, error: null });
    const res = await get(`?sesi_id=${SESI}&riwayat=1`);
    expect(res.status).toBe(403);
    expect(serverState.rpc).toHaveBeenCalledWith('boleh_chat_sesi', { p_sesi: SESI });
  });

  it('A1: staf tanpa izin lintas sesi (chat_boleh_riwayat false) memuat riwayat dengan klien berJWT (RLS), bukan service-role', async () => {
    const { admin } = mockAdmin({ actor: { kind: 'staff', role: 'front_office', layanan_id: null } });
    const rls = chainRiwayat([barisRiwayat('m1', 's', '2026-10-30T01:00:00Z')]);
    const rlsSesi = chainRiwayat([{ id: 'sesi-2' }]);
    serverState.from = vi.fn((t: string) => (t === 'chat_pesan' ? rls.b : rlsSesi.b));
    serverState.rpc.mockImplementation(async (nama: string) =>
      nama === 'boleh_chat_sesi' ? { data: true, error: null } : { data: false, error: null },
    );
    const res = await get(`?sesi_id=${SESI}&riwayat=1`);
    expect(res.status).toBe(200);
    expect(serverState.rpc).toHaveBeenCalledWith('chat_boleh_riwayat', { p_sesi: SESI });
    expect(serverState.from).toHaveBeenCalledWith('chat_pesan');
    // service-role tidak menyentuh chat_pesan untuk riwayat lintas sesi
    expect(admin.from.mock.calls.some(([t]: [string]) => t === 'chat_pesan')).toBe(false);
    expect((await res.json()).messages).toHaveLength(1);
  });

  it('A1: chat_boleh_riwayat true (admin/FO Koordinator/petugas jangkar) memuat lintas sesi dengan service-role', async () => {
    const { admin } = mockAdmin({ actor: { kind: 'staff', role: 'admin', layanan_id: null }, riwayat: [barisRiwayat('m1', 's1', '2026-10-30T01:00:00Z')] });
    serverState.rpc.mockResolvedValue({ data: true, error: null });
    const res = await get(`?sesi_id=${SESI}&riwayat=1`);
    expect(res.status).toBe(200);
    expect(admin.from.mock.calls.some(([t]: [string]) => t === 'chat_pesan')).toBe(true);
    expect(serverState.from).not.toHaveBeenCalled();
  });

  it('A1: galat RPC riwayat (bukan "belum ada") = gagal tertutup ke klien RLS; RPC belum ada = perilaku lama (service-role)', async () => {
    const { admin } = mockAdmin({ actor: { kind: 'staff', role: 'petugas', layanan_id: LAYANAN } });
    const rls = chainRiwayat([]);
    serverState.from = vi.fn(() => rls.b);
    serverState.rpc.mockImplementation(async (nama: string) =>
      nama === 'boleh_chat_sesi' ? { data: true, error: null } : { data: null, error: { code: '57014', message: 'timeout' } },
    );
    expect((await get(`?sesi_id=${SESI}&riwayat=1`)).status).toBe(200);
    expect(serverState.from).toHaveBeenCalled();
    expect(admin.from.mock.calls.some(([t]: [string]) => t === 'chat_pesan')).toBe(false);

    vi.resetModules();
    serverState.from = vi.fn();
    const m2 = mockAdmin({ actor: { kind: 'staff', role: 'petugas', layanan_id: LAYANAN }, riwayat: [] });
    serverState.rpc.mockImplementation(async (nama: string) =>
      nama === 'boleh_chat_sesi' ? { data: true, error: null } : { data: null, error: { code: 'PGRST202', message: 'tidak ada' } },
    );
    expect((await get(`?sesi_id=${SESI}&riwayat=1`)).status).toBe(200);
    expect(m2.admin.from.mock.calls.some(([t]: [string]) => t === 'chat_pesan')).toBe(true);
    expect(serverState.from).not.toHaveBeenCalled();
  });

  it('staf: RPC true -> riwayat dimuat (petugas yang menangani)', async () => {
    mockAdmin({ actor: { kind: 'staff', role: 'petugas', layanan_id: LAYANAN }, riwayat: [barisRiwayat('m1', 's', '2026-10-30T01:00:00Z')] });
    serverState.rpc.mockResolvedValue({ data: true, error: null });
    const res = await get(`?sesi_id=${SESI}&riwayat=1`);
    expect(res.status).toBe(200);
    expect((await res.json()).messages).toHaveLength(1);
  });

  it('staf: RPC galat selain "belum ada" -> tertutup (403); RPC belum ada -> aturan TS lama', async () => {
    mockAdmin({ actor: { kind: 'staff', role: 'front_office', layanan_id: null } });
    serverState.rpc.mockResolvedValue({ data: null, error: { code: '57014', message: 'timeout' } });
    expect((await get(`?sesi_id=${SESI}`)).status).toBe(403);
    serverState.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'tidak ada' } });
    expect((await get(`?sesi_id=${SESI}`)).status).toBe(200); // FO = semua (aturan lama)
  });
});

describe('POST /api/chat/messages: permintaan petugas implisit (Fase 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    serverState.callerId = 'auth-1';
    serverState.rpc = vi.fn(async () => ({ data: { ok: true, noop: true }, error: null }));
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  });

  it('pesan pengunjung pada sesi eskalasi memanggil chat_minta_petugas(p_eksplisit=false) sekali', async () => {
    mockAdmin({ actor: { kind: 'pengunjung' }, sesiStatus: 'eskalasi' });
    const res = await post({ sesi_id: SESI, isi: 'Halo' });
    expect(res.status).toBe(201);
    expect(serverState.rpc).toHaveBeenCalledTimes(1);
    expect(serverState.rpc).toHaveBeenCalledWith('chat_minta_petugas', { p_sesi_id: SESI, p_eksplisit: false });
  });

  it('sesi bot: tidak memanggil RPC; RPC melempar/galat: pengiriman tetap 201', async () => {
    mockAdmin({ actor: { kind: 'pengunjung' }, sesiStatus: 'bot' });
    expect((await post({ sesi_id: SESI, isi: 'Halo' })).status).toBe(201);
    expect(serverState.rpc).not.toHaveBeenCalled();

    vi.resetModules();
    mockAdmin({ actor: { kind: 'pengunjung' }, sesiStatus: 'eskalasi' });
    serverState.rpc = vi.fn(async () => {
      throw new Error('jaringan');
    });
    expect((await post({ sesi_id: SESI, isi: 'Halo' })).status).toBe(201);
  });
});
