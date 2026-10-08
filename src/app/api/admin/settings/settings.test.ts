// @vitest-environment node
// Route konsol pengaturan: semua klien dimock. Fokus: hanya Admin, kunci tidak pernah bocor, SSRF, aktivasi.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';

const g = vi.hoisted(() => ({
  gate: null as unknown,
  staf: null as unknown,
  service: null as unknown,
  jatah: true,
}));

vi.mock('@/lib/akun/server', async (orig) => ({
  ...(await orig<typeof import('@/lib/akun/server')>()),
  requireAdmin: vi.fn(async () => g.gate),
  requireStaf: vi.fn(async () => g.staf),
  getServiceClient: vi.fn(() => g.service),
  ambilJatah: vi.fn(async () => g.jatah),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

const SECRET = 'sk-SANGAT-RAHASIA-1234567890wxyz';
const E1 = '00000000-0000-4000-8000-000000000001';
const RID = '00000000-0000-4000-8000-0000000000aa';
const LAY = '550e8400-e29b-41d4-a716-446655440000';
const actor = { id: 'p-admin', role: 'admin', aktif: true, auth_user_id: 'a' };

type Log = Array<{ table: string; op: string; args: unknown[] }>;
function makeService(results: Record<string, unknown> = {}, rpcResult: { data?: unknown; error?: { message: string } | null } = { data: 3, error: null }) {
  const log: Log = [];
  const rpc = vi.fn(async () => ({ data: rpcResult.data ?? null, error: rpcResult.error ?? null }));
  const service = {
    rpc,
    from: (table: string) => {
      const result = results[table] ?? { data: null, error: null };
      const c: unknown = new Proxy({}, {
        get: (_t, p) => {
          if (p === 'then') return (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
          return (...args: unknown[]) => { log.push({ table, op: String(p), args }); return c; };
        },
      });
      return c;
    },
  };
  return { service, log, rpc };
}
const admin = (service: unknown) => { g.gate = { actor, service }; g.service = service; };
const req = (body?: unknown) =>
  new Request('http://localhost/api/admin/settings/x', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
const entry = (o: object = {}) => ({ id: E1, label: 'GW', tipe: 'openai_compat', base_url: 'https://gw.example.com/v1', model: 'm', aktif: true, ...o });

beforeEach(() => {
  vi.resetModules();
  g.gate = null; g.staf = null; g.service = null; g.jatah = true;
  process.env.SETTINGS_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
});
afterEach(() => {
  delete process.env.SETTINGS_ENCRYPTION_KEY;
  vi.unstubAllGlobals();
  vi.doUnmock('@/lib/settings/ssrf');
  vi.doUnmock('@/lib/llm/bot');
});

describe('akses: hanya Admin aktif', () => {
  it('semua route admin meneruskan 401/403 dari requireAdmin', async () => {
    const { json } = await import('@/lib/akun/server');
    g.gate = { res: json({ error: 'Hanya Admin' }, 403) };
    expect((await (await import('./llm/route')).GET()).status).toBe(403);
    expect((await (await import('./llm/route')).PUT(req({}))).status).toBe(403);
    expect((await (await import('./llm/rahasia/route')).POST(req({}))).status).toBe(403);
    expect((await (await import('./llm/test/route')).POST(req({}))).status).toBe(403);
    expect((await (await import('./llm/versi/route')).POST(req({}))).status).toBe(403);
  });
});

describe('POST llm/rahasia (write-only)', () => {
  it('menyimpan terenkripsi; respons & audit TANPA kunci; hanya 4 akhir tersamar', async () => {
    const m = makeService({ rahasia_pengaturan: { data: { id: RID }, error: null } });
    admin(m.service);
    const res = await (await import('./llm/rahasia/route')).POST(req({ nama: 'Groq', kunci: SECRET }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, rahasia_id: RID, kunci_tersamar: '••••wxyz' });
    const dump = JSON.stringify(m.log);
    expect(dump).not.toContain(SECRET);
    const ins = m.log.find((l) => l.table === 'rahasia_pengaturan' && l.op === 'insert')!.args[0] as Record<string, unknown>;
    expect(ins).toMatchObject({ nama: 'Groq', key_id: 1, last4: 'wxyz' });
    expect(ins.ciphertext).toBeTruthy();
  });
  it('tanpa SETTINGS_ENCRYPTION_KEY -> 503 pesan jelas, tidak ada insert', async () => {
    delete process.env.SETTINGS_ENCRYPTION_KEY;
    const m = makeService();
    admin(m.service);
    const res = await (await import('./llm/rahasia/route')).POST(req({ nama: 'Groq', kunci: SECRET }));
    expect(res.status).toBe(503);
    expect((await res.json()).kode).toBe('ENKRIPSI_BELUM_DIATUR');
    expect(m.log.some((l) => l.op === 'insert')).toBe(false);
  });
  it('input tak valid (kunci pendek / field asing) -> 400; batas laju -> 429', async () => {
    const m = makeService();
    admin(m.service);
    const { POST } = await import('./llm/rahasia/route');
    expect((await POST(req({ nama: 'x', kunci: 'pendek' }))).status).toBe(400);
    expect((await POST(req({ nama: 'x', kunci: SECRET, extra: 1 }))).status).toBe(400);
    g.jatah = false;
    expect((await POST(req({ nama: 'x', kunci: SECRET }))).status).toBe(429);
  });
});

describe('GET/PUT llm', () => {
  it('GET: tidak pernah memilih/mengirim ciphertext; kunci tersamar', async () => {
    const m = makeService({
      pengaturan_sistem: { data: [{ versi: 2, status: 'draf', nilai: [entry({ rahasia_id: RID })], alasan: null, hasil_uji: {}, diuji_at: null, dibuat_at: 'x', diaktifkan_at: null }], error: null },
      rahasia_pengaturan: { data: [{ id: RID, last4: 'wxyz' }], error: null },
    });
    admin(m.service);
    const res = await (await import('./llm/route')).GET();
    const body = await res.json();
    expect(body.draf.entries[0]).toMatchObject({ punya_kunci: true, kunci_tersamar: '••••wxyz' });
    expect(body.sumber_aktif).toBe('env');
    expect(body.enkripsi_siap).toBe(true);
    const sel = m.log.find((l) => l.table === 'rahasia_pengaturan' && l.op === 'select')!.args[0];
    expect(sel).toBe('id, last4');
    expect(JSON.stringify(body)).not.toMatch(/ciphertext|"iv"|"tag"/);
  });
  it('PUT: base URL privat/http ditolak (400) sebelum menyentuh DB', async () => {
    const m = makeService();
    admin(m.service);
    vi.stubGlobal('fetch', vi.fn());
    const { PUT } = await import('./llm/route');
    const r1 = await PUT(req({ entries: [entry({ base_url: 'http://gw.example.com/v1' })] }));
    expect(r1.status).toBe(400);
    expect(JSON.stringify(await r1.json())).toContain('https');
    const r2 = await PUT(req({ entries: [entry({ base_url: 'https://169.254.169.254/v1' })] }));
    expect(r2.status).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('PUT: rahasia_id tak dikenal -> 400; valid -> RPC simpan_draf dengan petugas.id', async () => {
    vi.doMock('@/lib/settings/ssrf', async (orig) => ({ ...(await orig<typeof import('@/lib/settings/ssrf')>()), validateBaseUrl: vi.fn(async (u: string) => ({ ok: true, url: new URL(u), ip: { address: '93.184.216.34', family: 4 } })) }));
    const bad = makeService({ rahasia_pengaturan: { data: [], error: null } });
    admin(bad.service);
    const { PUT } = await import('./llm/route');
    expect((await PUT(req({ entries: [entry({ rahasia_id: RID })] }))).status).toBe(400);
    const good = makeService({ rahasia_pengaturan: { data: [{ id: RID }], error: null } }, { data: 4 });
    admin(good.service);
    const res = await PUT(req({ entries: [entry({ rahasia_id: RID })], alasan: 'tambah gateway' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, versi: 4 });
    expect(good.rpc).toHaveBeenCalledWith('simpan_draf_pengaturan', expect.objectContaining({ p_kunci: 'llm.rantai_chat', p_oleh: 'p-admin' }));
    // pemakaian pertama (host NULL) mengikat rahasia ke host entri
    expect(good.log.some((l) => l.table === 'rahasia_pengaturan' && l.op === 'update' && JSON.stringify(l.args[0]) === '{"host":"gw.example.com"}')).toBe(true);
    vi.doUnmock('@/lib/settings/ssrf');
  });
  it('PUT: kunci terikat ke host lain ditolak 400 dan tidak disimpan; host sama lolos', async () => {
    vi.doMock('@/lib/settings/ssrf', async (orig) => ({ ...(await orig<typeof import('@/lib/settings/ssrf')>()), validateBaseUrl: vi.fn(async (u: string) => ({ ok: true, url: new URL(u), ip: { address: '93.184.216.34', family: 4 } })) }));
    const m = makeService({ rahasia_pengaturan: { data: [{ id: RID, host: 'api.groq.com' }], error: null } });
    admin(m.service);
    const { PUT } = await import('./llm/route');
    const res = await PUT(req({ entries: [entry({ rahasia_id: RID })] }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('api.groq.com');
    expect(m.rpc).not.toHaveBeenCalled();
    const ok = makeService({ rahasia_pengaturan: { data: [{ id: RID, host: 'gw.example.com' }], error: null } });
    admin(ok.service);
    expect((await PUT(req({ entries: [entry({ rahasia_id: RID })] }))).status).toBe(200);
    vi.doUnmock('@/lib/settings/ssrf');
  });
  it('POST rahasia: base_url mengikat host saat dibuat; base_url tak valid 400', async () => {
    const m = makeService({ rahasia_pengaturan: { data: { id: RID }, error: null } });
    admin(m.service);
    const { POST } = await import('./llm/rahasia/route');
    expect((await POST(req({ nama: 'G', kunci: SECRET, base_url: 'bukan url' }))).status).toBe(400);
    expect((await POST(req({ nama: 'G', kunci: SECRET, base_url: 'https://API.Groq.com/openai/v1' }))).status).toBe(200);
    const ins = m.log.find((l) => l.table === 'rahasia_pengaturan' && l.op === 'insert')!.args[0] as Record<string, unknown>;
    expect(ins.host).toBe('api.groq.com');
  });
});

describe('POST llm/versi', () => {
  it('aktifkan belum diuji -> 409 BELUM_DIUJI; sukses -> 200', async () => {
    const m = makeService({}, { error: { message: 'BELUM_DIUJI: setiap penyedia aktif harus lulus uji' } });
    admin(m.service);
    const { POST } = await import('./llm/versi/route');
    const r = await POST(req({ aksi: 'aktifkan', versi: 2 }));
    expect(r.status).toBe(409);
    expect((await r.json()).kode).toBe('BELUM_DIUJI');
    const ok = makeService({}, { data: 2 });
    admin(ok.service);
    const r2 = await POST(req({ aksi: 'aktifkan', versi: 2, tanpa_uji: true, alasan: 'darurat produksi' }));
    expect(r2.status).toBe(200);
    expect(ok.rpc).toHaveBeenCalledWith('aktifkan_pengaturan', expect.objectContaining({ p_tanpa_uji: true, p_versi: 2 }));
  });
  it('rollback memanggil rollback_pengaturan; galat tak dikenal -> 500 generik tanpa bocor pesan DB', async () => {
    const m = makeService({}, { error: { message: 'relation "x" does not exist secret-detail' } });
    admin(m.service);
    const { POST } = await import('./llm/versi/route');
    const r = await POST(req({ aksi: 'rollback', versi: 1, alasan: 'versi baru bermasalah' }));
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain('secret-detail');
    expect(m.rpc).toHaveBeenCalledWith('rollback_pengaturan', expect.objectContaining({ p_versi_sumber: 1 }));
  });
});

describe('POST llm/test', () => {
  it('menguji entri draf: hasil + curl tersamar, kunci asli tidak bocor, hasil disimpan ke draf', async () => {
    const { encryptSecret } = await import('@/lib/settings/crypto');
    const blob = encryptSecret(SECRET);
    const m = makeService({
      pengaturan_sistem: { data: { id: 'row-1', nilai: [entry({ rahasia_id: RID })], hasil_uji: {} }, error: null },
      rahasia_pengaturan: { data: { id: RID, ...blob, last4: 'wxyz' }, error: null },
    });
    admin(m.service);
    vi.doMock('@/lib/settings/ssrf', async (orig) => ({
      ...(await orig<typeof import('@/lib/settings/ssrf')>()),
      makeGuardedFetch: () => (async () => new Response(JSON.stringify({ choices: [{ message: { content: 'SIAP' } }] }), { status: 200 })) as never,
    }));
    const res = await (await import('./llm/test/route')).POST(req({ entry_id: E1 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, http_status: 200, cuplikan: 'SIAP' });
    expect(body.curl).toContain('Bearer ••••wxyz');
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(JSON.stringify(m.log)).not.toContain(SECRET);
    const upd = m.log.find((l) => l.table === 'pengaturan_sistem' && l.op === 'update')!.args[0] as { hasil_uji: Record<string, { ok: boolean }> };
    expect(upd.hasil_uji[E1].ok).toBe(true);
    vi.doUnmock('@/lib/settings/ssrf');
  });
  it('entri tidak ada -> 404; batas 20/jam -> 429', async () => {
    const m = makeService({ pengaturan_sistem: { data: { id: 'row-1', nilai: [entry()], hasil_uji: {} }, error: null } });
    admin(m.service);
    const { POST } = await import('./llm/test/route');
    expect((await POST(req({ entry_id: '00000000-0000-4000-8000-0000000000ff' }))).status).toBe(404);
    g.jatah = false;
    expect((await POST(req({ entry_id: E1 }))).status).toBe(429);
  });
  it('gateway mengarah ke IP privat -> hasil gagal (ok=false), tidak ada koneksi', async () => {
    const m = makeService({ pengaturan_sistem: { data: { id: 'row-1', nilai: [entry({ base_url: 'https://127.0.0.1/v1' })], hasil_uji: {} }, error: null } });
    admin(m.service);
    const body = await (await (await import('./llm/test/route')).POST(req({ entry_id: E1 }))).json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/ditolak/);
  });
});

describe('POST bot/coba', () => {
  const stafOf = (role: string, layanan_id: string | null) => { g.staf = { supabase: {}, user: { id: 'u' }, me: { id: 'p1', role, layanan_id } }; };
  it('petugas hanya untuk layanan sendiri (403); tanpa login 401', async () => {
    const { POST } = await import('./bot/coba/route');
    const { json } = await import('@/lib/akun/server');
    g.staf = { res: json({ error: 'Unauthorized' }, 401) };
    expect((await POST(req({ pertanyaan: 'apa syarat NIB', layanan_id: LAY }))).status).toBe(401);
    stafOf('petugas', '11111111-1111-4111-8111-111111111111');
    g.service = makeService().service;
    expect((await POST(req({ pertanyaan: 'apa syarat NIB', layanan_id: LAY }))).status).toBe(403);
  });
  it('jalan tanpa menyimpan apa pun (tidak ada insert/update) dan mengembalikan jawaban + penyedia', async () => {
    vi.doMock('@/lib/llm/bot', () => ({
      jalankanBot: vi.fn(async () => ({
        kind: 'ok', jawaban: 'Syarat: KTP', sumber: [], sumberDokumen: [], eskalasi: false, reason: null, faqIds: [], topSim: 0.9,
        sumberFaqId: null, provider: 'GW', mode: { tutup: false, alasan: null, kerjaBerikutnya: null },
      })),
    }));
    const m = makeService({ layanan: { data: { nama: 'Dinas A', chatbot_aktif: false }, error: null } });
    g.service = m.service;
    stafOf('admin', null);
    const res = await (await import('./bot/coba/route')).POST(req({ pertanyaan: 'apa syarat NIB', layanan_id: LAY }));
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, jawaban: 'Syarat: KTP', penyedia: 'GW', chatbot_aktif: false });
    expect(m.log.some((l) => ['insert', 'update', 'upsert', 'delete'].includes(l.op))).toBe(false);
    vi.doUnmock('@/lib/llm/bot');
  });
});
