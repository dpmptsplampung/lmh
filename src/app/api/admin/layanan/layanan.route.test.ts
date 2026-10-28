// @vitest-environment node
// API admin Layanan: GET/POST, PATCH, arsip, hapus, tautan. Semua klien Supabase dimock (migrasi belum diterapkan).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({})) }));
vi.mock('@/lib/observability/logger', () => ({ logServerEvent: vi.fn() }));

import type { NextRequest } from 'next/server';

const ID = '660e8400-e29b-41d4-a716-446655440001';
const INSTANSI = '770e8400-e29b-41d4-a716-446655440002';
type Hasil = { data?: unknown; error?: { code?: string; message: string } | null; count?: number | null };
type Panggilan = {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete';
  values?: unknown;
  filters: Array<[string, unknown]>;
};

const req = (method: string, body?: unknown) =>
  new Request('http://localhost/api/admin/layanan', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });

async function setup(o: {
  role?: string | null;
  /** Menimpa hasil query default; kembalikan undefined untuk memakai default. */
  jawab?: (c: Panggilan) => Hasil | undefined;
} = {}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  const role = o.role === undefined ? 'admin' : o.role;
  const calls: Panggilan[] = [];
  const serverMod = await import('@/lib/supabase/server');
  (serverMod.createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: role ? { id: 'auth-1' } : null } }) },
    from: (table: string) => {
      const c: Panggilan = { table, op: 'select', filters: [] };
      let single = false;
      const b: Record<string, unknown> = {};
      const rantai = () => b;
      Object.assign(b, {
        select: rantai,
        insert: (v: unknown) => { c.op = 'insert'; c.values = v; return b; },
        update: (v: unknown) => { c.op = 'update'; c.values = v; return b; },
        delete: () => { c.op = 'delete'; return b; },
        eq: (k: string, v: unknown) => { c.filters.push([k, v]); return b; },
        order: rantai,
        single: () => { single = true; return b; },
        maybeSingle: () => { single = true; return b; },
        then: (res: (v: Hasil) => unknown, rej?: (e: unknown) => unknown) => {
          // Pencarian aktor (requireAdmin/requireStaf) = petugas difilter auth_user_id; hitung pemakaian layanan memakai layanan_id.
          if (table === 'petugas' && c.filters.some(([k]) => k === 'auth_user_id')) {
            return Promise.resolve({ data: role ? { id: 'p1', role, aktif: true } : null, error: null }).then(res, rej);
          }
          calls.push(c);
          const kustom = o.jawab?.(c);
          let hasil: Hasil;
          if (kustom) hasil = { error: null, ...kustom };
          else if (c.op === 'select') hasil = { data: single ? null : [], error: null, count: 0 };
          else if (c.op === 'insert') hasil = { data: single ? { id: 'baru', slug: 'slug-baru' } : null, error: null };
          else hasil = { data: [{ id: ID }], error: null };
          return Promise.resolve(hasil).then(res, rej);
        },
      });
      return b;
    },
  });
  const logger = await import('@/lib/observability/logger');
  vi.mocked(logger.logServerEvent).mockClear();
  return { calls, log: vi.mocked(logger.logServerEvent) };
}

describe('GET /api/admin/layanan', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  it('Admin: layanan (website_terkait terurut), instansi, bisa_ubah true', async () => {
    await setup({
      jawab: (c) => {
        if (c.table === 'layanan') {
          return { data: [{ id: ID, nama: 'A', aktif: false, layanan_tautan: [{ label: 'B', url: 'https://b.id', urut: 1 }, { label: 'A', url: 'https://a.id', urut: 0 }] }] };
        }
        if (c.table === 'instansi') return { data: [{ id: INSTANSI, nama: 'DPMPTSP', singkatan: null }] };
      },
    });
    const res = await (await import('./route')).GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bisa_ubah).toBe(true);
    expect(body.instansi).toHaveLength(1);
    expect(body.layanan[0].aktif).toBe(false);
    expect(body.layanan[0].website_terkait).toEqual([{ label: 'A', url: 'https://a.id' }, { label: 'B', url: 'https://b.id' }]);
    expect(body.layanan[0]).not.toHaveProperty('layanan_tautan');
  });
  it('memilih kolom tampil_di_homepage; bila kolom belum ada (migrasi 202610280001) diulang tanpa kolom itu', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
    let percobaan = 0;
    const kolomDiminta: string[] = [];
    const serverMod = await import('@/lib/supabase/server');
    (serverMod.createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'auth-1' } } }) },
      from: (table: string) => {
        const b: Record<string, unknown> = {};
        Object.assign(b, {
          select: (kolom?: string) => { if (table === 'layanan') kolomDiminta.push(String(kolom)); return b; },
          eq: () => b,
          order: () => b,
          single: () => b,
          maybeSingle: () => b,
          then: (res: (v: Hasil) => unknown, rej?: (e: unknown) => unknown) => {
            if (table === 'petugas') return Promise.resolve({ data: { id: 'p1', role: 'admin', aktif: true }, error: null }).then(res, rej);
            if (table === 'layanan') {
              percobaan += 1;
              const hasil: Hasil = percobaan === 1
                ? { data: null, error: { code: '42703', message: 'column layanan.tampil_di_homepage does not exist' } }
                : { data: [{ id: ID, nama: 'A', aktif: true, layanan_tautan: [] }], error: null };
              return Promise.resolve(hasil).then(res, rej);
            }
            return Promise.resolve({ data: [], error: null }).then(res, rej);
          },
        });
        return b;
      },
    });
    const res = await (await import('./route')).GET();
    expect(res.status).toBe(200);
    expect(kolomDiminta).toHaveLength(2);
    expect(kolomDiminta[0]).toContain('tampil_di_homepage');
    expect(kolomDiminta[1]).not.toContain('tampil_di_homepage');
    expect((await res.json()).layanan[0].tampil_di_homepage).toBe(true);
  });
  it('Front Office: 200 dengan bisa_ubah false; petugas: 403', async () => {
    await setup({ role: 'front_office' });
    const res = await (await import('./route')).GET();
    expect(res.status).toBe(200);
    expect((await res.json()).bisa_ubah).toBe(false);
    vi.resetModules();
    await setup({ role: 'petugas' });
    expect((await (await import('./route')).GET()).status).toBe(403);
  });
});

describe('POST /api/admin/layanan', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  it('menolak non-admin (403) dan URL http:// (400)', async () => {
    await setup({ role: 'front_office' });
    expect((await (await import('./route')).POST(req('POST', { nama: 'Layanan Baru' }))).status).toBe(403);
    vi.resetModules();
    const s = await setup();
    const { POST } = await import('./route');
    expect((await POST(req('POST', { nama: 'Layanan Baru', konten_sumber_url: 'http://contoh.go.id' }))).status).toBe(400);
    expect(s.calls).toHaveLength(0);
  });
  it('nama wajib, spasi saja ditolak setelah trim, slug dibatasi 80 dan format', async () => {
    await setup();
    const { POST } = await import('./route');
    expect((await POST(req('POST', {}))).status).toBe(400);
    expect((await POST(req('POST', { nama: '   ' }))).status).toBe(400);
    expect((await POST(req('POST', { nama: 'Layanan', slug: 'Tidak Valid' }))).status).toBe(400);
    expect((await POST(req('POST', { nama: 'Layanan', slug: 'a'.repeat(81) }))).status).toBe(400);
  });
  it('mengirim form_pendataan null apa adanya dan membalas 201 {id, slug}', async () => {
    const s = await setup();
    const res = await (await import('./route')).POST(req('POST', { nama: '  Layanan Baru  ', instansi_id: INSTANSI }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'baru', slug: 'slug-baru' });
    const ins = s.calls.find((c) => c.table === 'layanan' && c.op === 'insert');
    expect(ins?.values).toMatchObject({ nama: 'Layanan Baru', instansi_id: INSTANSI });
    expect(ins?.values).toHaveProperty('form_pendataan', null);
  });
  it.each([
    ['42703', 'column "tampil_di_homepage" of relation "layanan" does not exist'],
    ['PGRST204', "Could not find the 'tampil_di_homepage' column of 'layanan' in the schema cache"],
  ])('kolom tampil_di_homepage belum ada (%s): POST diulang tanpa kolom itu dan tetap 201', async (code, message) => {
    let kali = 0;
    const s = await setup({
      jawab: (c) => {
        if (c.op !== 'insert') return undefined;
        kali += 1;
        return kali === 1 ? { data: null, error: { code, message } } : undefined;
      },
    });
    const res = await (await import('./route')).POST(req('POST', { nama: 'Layanan Baru', tampil_di_homepage: true }));
    expect(res.status).toBe(201);
    const inserts = s.calls.filter((c) => c.op === 'insert');
    expect(inserts).toHaveLength(2);
    expect(inserts[0].values).toHaveProperty('tampil_di_homepage', true);
    expect(inserts[1].values).not.toHaveProperty('tampil_di_homepage');
    expect(inserts[1].values).toMatchObject({ nama: 'Layanan Baru' });
  });
  it('galat 42703 untuk kolom lain tidak diulang (500)', async () => {
    const s = await setup({
      jawab: (c) => (c.op === 'insert' ? { data: null, error: { code: '42703', message: 'column "lain" does not exist' } } : undefined),
    });
    const res = await (await import('./route')).POST(req('POST', { nama: 'Layanan Baru' }));
    expect(res.status).toBe(500);
    expect(s.calls.filter((c) => c.op === 'insert')).toHaveLength(1);
  });
  it('tampil_di_homepage diteruskan ke baris yang disisipkan; nilai bukan boolean ditolak (400)', async () => {
    const s = await setup();
    const { POST } = await import('./route');
    await POST(req('POST', { nama: 'Layanan Baru', tampil_di_homepage: false }));
    expect(s.calls.find((c) => c.op === 'insert')?.values).toMatchObject({ tampil_di_homepage: false });
    expect((await POST(req('POST', { nama: 'Layanan Baru', tampil_di_homepage: 'ya' }))).status).toBe(400);
  });
  it('form_pendataan eksplisit diteruskan', async () => {
    const s = await setup();
    await (await import('./route')).POST(req('POST', { nama: 'Layanan Baru', form_pendataan: 'oss' }));
    expect(s.calls.find((c) => c.op === 'insert')?.values).toMatchObject({ form_pendataan: 'oss' });
  });
  it('23505: nama / prefiks / slug dibedakan -> 409 NAMA_BENTROK / PREFIKS_BENTROK / SLUG_BENTROK', async () => {
    const kasus: Array<[string, string]> = [
      ['duplicate key value violates unique constraint "layanan_nama_key"', 'NAMA_BENTROK'],
      ['duplicate key value violates unique constraint "uq_layanan_prefiks_antrean"', 'PREFIKS_BENTROK'],
      ['duplicate key value violates unique constraint "uq_layanan_slug"', 'SLUG_BENTROK'],
    ];
    for (const [message, kode] of kasus) {
      vi.resetModules();
      await setup({ jawab: (c) => (c.op === 'insert' ? { data: null, error: { code: '23505', message } } : undefined) });
      const res = await (await import('./route')).POST(req('POST', { nama: 'Layanan Baru' }));
      expect(res.status).toBe(409);
      expect((await res.json()).kode).toBe(kode);
    }
  });
});

describe('PATCH /api/admin/layanan/[id]', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  it('menolak non-admin (403), id jelek (400), kunci tak dikenal / kosong (400)', async () => {
    await setup({ role: 'front_office' });
    expect((await (await import('./[id]/route')).PATCH(req('PATCH', { nama: 'Baru' }), ctx())).status).toBe(403);
    vi.resetModules();
    await setup();
    const { PATCH } = await import('./[id]/route');
    expect((await PATCH(req('PATCH', { nama: 'Baru' }), ctx('bukan-uuid'))).status).toBe(400);
    expect((await PATCH(req('PATCH', { aktif: false }), ctx())).status).toBe(400);
    expect((await PATCH(req('PATCH', {}), ctx())).status).toBe(400);
  });
  it('nama yang memuat "OSS" tidak lagi ditolak RENAME_UBAH_JENIS_FORM', async () => {
    const s = await setup({ jawab: (c) => (c.op === 'select' ? { data: { nama: 'Perizinan Umum' } } : undefined) });
    const res = await (await import('./[id]/route')).PATCH(req('PATCH', { nama: 'Helpdesk OSS Baru' }), ctx());
    expect(res.status).toBe(200);
    expect(s.calls.find((c) => c.op === 'update')?.values).toEqual({ nama: 'Helpdesk OSS Baru' });
  });
  it.each([
    ['42703', 'column "tampil_di_homepage" of relation "layanan" does not exist'],
    ['PGRST204', "Could not find the 'tampil_di_homepage' column of 'layanan' in the schema cache"],
  ])('kolom tampil_di_homepage belum ada (%s): PATCH diulang tanpa kolom itu bila masih ada field lain', async (code, message) => {
    let kali = 0;
    const s = await setup({
      jawab: (c) => {
        if (c.op !== 'update') return undefined;
        kali += 1;
        return kali === 1 ? { data: null, error: { code, message } } : undefined;
      },
    });
    const res = await (await import('./[id]/route')).PATCH(req('PATCH', { nama: 'Baru', tampil_di_homepage: false }), ctx());
    expect(res.status).toBe(200);
    const updates = s.calls.filter((c) => c.op === 'update');
    expect(updates).toHaveLength(2);
    expect(updates[1].values).toEqual({ nama: 'Baru' });
  });
  it('kolom tampil_di_homepage belum ada dan hanya itu yang diubah: 409 MIGRASI_BELUM_DITERAPKAN (bukan sukses palsu)', async () => {
    await setup({
      jawab: (c) => (c.op === 'update'
        ? { data: null, error: { code: '42703', message: 'column "tampil_di_homepage" of relation "layanan" does not exist' } }
        : undefined),
    });
    const res = await (await import('./[id]/route')).PATCH(req('PATCH', { tampil_di_homepage: false }), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).kode).toBe('MIGRASI_BELUM_DITERAPKAN');
  });
  it('tampil_di_homepage bisa diubah lewat PATCH', async () => {
    const s = await setup();
    const res = await (await import('./[id]/route')).PATCH(req('PATCH', { tampil_di_homepage: false }), ctx());
    expect(res.status).toBe(200);
    expect(s.calls.find((c) => c.op === 'update')?.values).toEqual({ tampil_di_homepage: false });
  });
  it('deskripsi yang berubah mengisi konten_diperbarui_at', async () => {
    const s = await setup({ jawab: (c) => (c.op === 'select' ? { data: { deskripsi: 'lama', konten_sumber_url: null } } : undefined) });
    const res = await (await import('./[id]/route')).PATCH(req('PATCH', { deskripsi: '  baru  ' }), ctx());
    expect(res.status).toBe(200);
    const nilai = s.calls.find((c) => c.op === 'update')?.values as Record<string, unknown>;
    expect(nilai.deskripsi).toBe('baru');
    expect(typeof nilai.konten_diperbarui_at).toBe('string');
  });
  it('deskripsi yang sama persis tidak mengubah konten_diperbarui_at', async () => {
    const s = await setup({ jawab: (c) => (c.op === 'select' ? { data: { deskripsi: 'sama', konten_sumber_url: null } } : undefined) });
    await (await import('./[id]/route')).PATCH(req('PATCH', { deskripsi: 'sama' }), ctx());
    expect(s.calls.find((c) => c.op === 'update')?.values).toEqual({ deskripsi: 'sama' });
  });
  it('PATCH layanan yang tidak ada = 404', async () => {
    await setup({ jawab: (c) => (c.op === 'select' ? { data: null } : undefined) });
    expect((await (await import('./[id]/route')).PATCH(req('PATCH', { deskripsi: 'x' }), ctx())).status).toBe(404);
    vi.resetModules();
    await setup({ jawab: (c) => (c.op === 'update' ? { data: [] } : undefined) });
    expect((await (await import('./[id]/route')).PATCH(req('PATCH', { nama: 'Nama Baru' }), ctx())).status).toBe(404);
  });
  it('slug bentrok 23505 -> 409 SLUG_BENTROK; prefiks bentrok -> PREFIKS_BENTROK', async () => {
    await setup({ jawab: (c) => (c.op === 'update' ? { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_layanan_slug"' } } : undefined) });
    const res = await (await import('./[id]/route')).PATCH(req('PATCH', { slug: 'sudah-ada' }), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).kode).toBe('SLUG_BENTROK');
    vi.resetModules();
    await setup({ jawab: (c) => (c.op === 'update' ? { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_layanan_prefiks_antrean"' } } : undefined) });
    const res2 = await (await import('./[id]/route')).PATCH(req('PATCH', { prefiks: 'ab' }), ctx());
    expect(res2.status).toBe(409);
    expect((await res2.json()).kode).toBe('PREFIKS_BENTROK');
  });
  it('prefiks huruf kecil dikapitalkan dan ditulis ke prefiks_antrean', async () => {
    const s = await setup();
    await (await import('./[id]/route')).PATCH(req('PATCH', { prefiks: 'ab' }), ctx());
    expect(s.calls.find((c) => c.op === 'update')?.values).toEqual({ prefiks_antrean: 'AB' });
  });
});

describe('POST /api/admin/layanan/[id]/arsip', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  it('arsip true menulis aktif=false dan diarsipkan_at; arsip false mengembalikan', async () => {
    const s = await setup();
    const { POST } = await import('./[id]/arsip/route');
    expect((await POST(req('POST', { arsip: true }), ctx())).status).toBe(200);
    const arsip = s.calls.find((c) => c.op === 'update')?.values as Record<string, unknown>;
    expect(arsip.aktif).toBe(false);
    expect(typeof arsip.diarsipkan_at).toBe('string');
    expect((await POST(req('POST', { arsip: false }), ctx())).status).toBe(200);
    const pulih = s.calls.filter((c) => c.op === 'update')[1].values;
    expect(pulih).toEqual({ aktif: true, diarsipkan_at: null });
  });
  it('403 non-admin, 400 body salah, 404 layanan tak ada', async () => {
    await setup({ role: 'front_office' });
    expect((await (await import('./[id]/arsip/route')).POST(req('POST', { arsip: true }), ctx())).status).toBe(403);
    vi.resetModules();
    await setup();
    expect((await (await import('./[id]/arsip/route')).POST(req('POST', { arsip: 'ya' }), ctx())).status).toBe(400);
    vi.resetModules();
    await setup({ jawab: (c) => (c.op === 'update' ? { data: [] } : undefined) });
    expect((await (await import('./[id]/arsip/route')).POST(req('POST', { arsip: true }), ctx())).status).toBe(404);
  });
});

describe('DELETE /api/admin/layanan/[id]', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  it('menolak 409 SUDAH_DIPAKAI bila hanya kunjungan.layanan_saran_id yang merujuk', async () => {
    const s = await setup({
      jawab: (c) => (c.table === 'kunjungan' && c.op === 'select' ? { data: null, count: 3 } : undefined),
    });
    const res = await (await import('./[id]/route')).DELETE(req('DELETE'), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).kode).toBe('SUDAH_DIPAKAI');
    expect(s.calls.find((c) => c.table === 'kunjungan')?.filters).toContainEqual(['layanan_saran_id', ID]);
    expect(s.calls.some((c) => c.op === 'delete')).toBe(false);
  });
  it.each(['tiket_antrean', 'penanganan', 'chat_sesi'])('menolak 409 bila %s (RESTRICT) merujuk', async (tabel) => {
    await setup({ jawab: (c) => (c.table === tabel && c.op === 'select' ? { data: null, count: 1 } : undefined) });
    expect((await (await import('./[id]/route')).DELETE(req('DELETE'), ctx())).status).toBe(409);
  });
  it.each(['pengaduan', 'petugas', 'dokumen_peraturan'])('menolak 409 bila hanya %s (SET NULL) yang merujuk', async (tabel) => {
    const s = await setup({ jawab: (c) => (c.table === tabel && c.op === 'select' ? { data: null, count: 2 } : undefined) });
    const res = await (await import('./[id]/route')).DELETE(req('DELETE'), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).kode).toBe('SUDAH_DIPAKAI');
    expect(s.calls.some((c) => c.op === 'delete')).toBe(false);
  });
  it.each(['rekap_harian_layanan', 'skm_response_rate'])('menolak 409 bila hanya %s (CASCADE riwayat) yang merujuk', async (tabel) => {
    const s = await setup({ jawab: (c) => (c.table === tabel && c.op === 'select' ? { data: null, count: 5 } : undefined) });
    const res = await (await import('./[id]/route')).DELETE(req('DELETE'), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).kode).toBe('SUDAH_DIPAKAI');
    expect(s.calls.some((c) => c.op === 'delete')).toBe(false);
  });
  it('galat saat menghitung pemakaian -> 500 tanpa menghapus', async () => {
    const s = await setup({ jawab: (c) => (c.table === 'petugas' && c.op === 'select' ? { data: null, error: { message: 'boom' } } : undefined) });
    expect((await (await import('./[id]/route')).DELETE(req('DELETE'), ctx())).status).toBe(500);
    expect(s.calls.some((c) => c.op === 'delete')).toBe(false);
  });
  it('layanan bersih dihapus -> 200 setelah kesembilan tabel dicek', async () => {
    const s = await setup();
    const res = await (await import('./[id]/route')).DELETE(req('DELETE'), ctx());
    expect(res.status).toBe(200);
    expect(s.calls.filter((c) => c.op === 'select').map((c) => c.table).sort()).toEqual([
      'chat_sesi', 'dokumen_peraturan', 'kunjungan', 'penanganan', 'pengaduan', 'petugas',
      'rekap_harian_layanan', 'skm_response_rate', 'tiket_antrean',
    ]);
    expect(s.calls.find((c) => c.op === 'delete')).toMatchObject({ table: 'layanan', filters: [['id', ID]] });
  });
  it('FK 23503 saat hapus -> 409; tidak ada baris -> 404; non-admin -> 403', async () => {
    await setup({ jawab: (c) => (c.op === 'delete' ? { data: null, error: { code: '23503', message: 'fk' } } : undefined) });
    expect((await (await import('./[id]/route')).DELETE(req('DELETE'), ctx())).status).toBe(409);
    vi.resetModules();
    await setup({ jawab: (c) => (c.op === 'delete' ? { data: [] } : undefined) });
    expect((await (await import('./[id]/route')).DELETE(req('DELETE'), ctx())).status).toBe(404);
    vi.resetModules();
    await setup({ role: 'front_office' });
    expect((await (await import('./[id]/route')).DELETE(req('DELETE'), ctx())).status).toBe(403);
  });
});

describe('PUT /api/admin/layanan/[id]/tautan', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
  const tautan = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `Situs ${i}`, url: `https://contoh${i}.go.id` }));

  it('menolak lebih dari 10 tautan, URL non-https, label kosong (400) dan non-admin (403)', async () => {
    const s = await setup();
    const { PUT } = await import('./[id]/tautan/route');
    expect((await PUT(req('PUT', { tautan: tautan(11) }), ctx())).status).toBe(400);
    expect((await PUT(req('PUT', { tautan: [{ label: 'X', url: 'http://x.go.id' }] }), ctx())).status).toBe(400);
    expect((await PUT(req('PUT', { tautan: [{ label: '  ', url: 'https://x.go.id' }] }), ctx())).status).toBe(400);
    expect(s.calls).toHaveLength(0);
    vi.resetModules();
    await setup({ role: 'front_office' });
    expect((await (await import('./[id]/tautan/route')).PUT(req('PUT', { tautan: [] }), ctx())).status).toBe(403);
  });
  it('mengganti seluruh daftar: urut = indeks, konten_diperbarui_at dicap, lama dihapus dulu', async () => {
    const s = await setup();
    const res = await (await import('./[id]/tautan/route')).PUT(req('PUT', { tautan: tautan(2) }), ctx());
    expect(res.status).toBe(200);
    const urutan = s.calls.map((c) => `${c.table}:${c.op}`);
    expect(urutan).toEqual(['layanan:update', 'layanan_tautan:delete', 'layanan_tautan:insert']);
    expect(typeof (s.calls[0].values as Record<string, unknown>).konten_diperbarui_at).toBe('string');
    expect(s.calls[1].filters).toEqual([['layanan_id', ID]]);
    expect(s.calls[2].values).toEqual([
      { layanan_id: ID, label: 'Situs 0', url: 'https://contoh0.go.id', urut: 0 },
      { layanan_id: ID, label: 'Situs 1', url: 'https://contoh1.go.id', urut: 1 },
    ]);
  });
  it('daftar kosong menghapus semua tanpa insert', async () => {
    const s = await setup();
    expect((await (await import('./[id]/tautan/route')).PUT(req('PUT', { tautan: [] }), ctx())).status).toBe(200);
    expect(s.calls.some((c) => c.op === 'insert')).toBe(false);
  });
  it('layanan tak ada = 404 tanpa menghapus; insert gagal = 500 dan tercatat', async () => {
    const s = await setup({ jawab: (c) => (c.table === 'layanan' ? { data: [] } : undefined) });
    expect((await (await import('./[id]/tautan/route')).PUT(req('PUT', { tautan: tautan(1) }), ctx())).status).toBe(404);
    expect(s.calls.some((c) => c.op === 'delete')).toBe(false);
    vi.resetModules();
    const s2 = await setup({ jawab: (c) => (c.table === 'layanan_tautan' && c.op === 'insert' ? { data: null, error: { code: '23514', message: 'check' } } : undefined) });
    const res = await (await import('./[id]/tautan/route')).PUT(req('PUT', { tautan: tautan(1) }), ctx());
    expect(res.status).toBe(500);
    expect(s2.log).toHaveBeenCalled();
  });
});
