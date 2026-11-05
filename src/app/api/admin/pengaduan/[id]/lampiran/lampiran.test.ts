// @vitest-environment node
// UI-04: GET /api/admin/pengaduan/[id]/lampiran -> {url} singkat bertanda tangan (R2 privat, 60 detik).
// Tanpa query = bukti pelapor (pengaduan.lampiran_path); ?lampiran_id=<uuid> = lampiran tanggapan.
// Hanya Admin dan Front Office aktif dengan sesi_valid() = true; FO tidak pernah membuka jalur integritas; tidak pernah URL bucket publik.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/observability/logger', () => ({ logServerEvent: vi.fn() }));
vi.mock('@/lib/storage/r2', () => ({ presignGet: vi.fn(), r2Tersedia: vi.fn(), urlPublik: vi.fn() }));

const ID = '11111111-2222-4333-8444-555555555555';
const LAMPIRAN_ID = '99999999-8888-4777-8666-555555555555';
const OBJ = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });
const req = (query = '') => new NextRequest(`http://localhost/api/admin/pengaduan/${ID}/lampiran${query}`);

type Hasil = { data: unknown; error: unknown };
interface Pasang {
  role?: string | null;
  aktif?: boolean;
  pengaduan?: Hasil;
  lampiran?: Hasil;
  /** Hasil RPC sesi_valid(); default sesi sah. Fungsi = perilaku khusus (mis. melempar). */
  sesi?: Hasil | (() => Promise<Hasil>);
}

const filter: Record<string, [string, unknown][]> = {};

async function pasang({ role = 'admin', aktif = true, pengaduan, lampiran, sesi = { data: true, error: null } }: Pasang = {}) {
  const { createClient } = await import('@/lib/supabase/server');
  const hasil: Record<string, Hasil> = {
    petugas: { data: role ? { role, aktif } : null, error: null },
    pengaduan: pengaduan ?? { data: { id: ID, jalur: 'layanan', lampiran_path: `${ID}/bukti.jpg` }, error: null },
    pengaduan_lampiran: lampiran ?? { data: { id: LAMPIRAN_ID, kunci: `pengaduan-bukti/${ID}/${OBJ}.pdf` }, error: null },
  };
  for (const k of Object.keys(filter)) delete filter[k];
  const from = vi.fn((tabel: string) => {
    filter[tabel] = [];
    const q = {
      select: vi.fn(() => q),
      eq: vi.fn((k: string, v: unknown) => { filter[tabel].push([k, v]); return q; }),
      maybeSingle: vi.fn(async () => hasil[tabel]),
    };
    return q;
  });
  const rpc = vi.fn(async () => (typeof sesi === 'function' ? sesi() : sesi));
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: role === null ? null : { id: 'u' } } }) },
    from,
    rpc,
  });
  const r2 = await import('@/lib/storage/r2');
  vi.mocked(r2.r2Tersedia).mockReturnValue(true);
  vi.mocked(r2.presignGet).mockResolvedValue('https://r2.example/ditandatangani?sig=1');
  return { from, r2, rpc };
}

async function panggil(query = '', id = ID) {
  const { GET } = await import('./route');
  return GET(req(query), ctx(id));
}

describe('GET /api/admin/pengaduan/[id]/lampiran', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  it('bukti pelapor: Admin mendapat URL bertanda tangan 60 detik dari bucket privat, tanpa cache', async () => {
    const { r2 } = await pasang();
    const res = await panggil();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://r2.example/ditandatangani?sig=1' });
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(r2.presignGet).toHaveBeenCalledWith('private', `pengaduan-bukti/${ID}/bukti.jpg`, 60);
    expect(r2.urlPublik).not.toHaveBeenCalled();
    expect(filter.pengaduan).toContainEqual(['id', ID]);
  });

  it('bukti pelapor: path yang sudah berawalan area dipakai apa adanya', async () => {
    const { r2 } = await pasang({ pengaduan: { data: { id: ID, jalur: 'layanan', lampiran_path: 'pengaduan-bukti/lama/foto.png' }, error: null } });
    expect((await panggil()).status).toBe(200);
    expect(r2.presignGet).toHaveBeenCalledWith('private', 'pengaduan-bukti/lama/foto.png', 60);
  });

  it.each([[null], ['../rahasia.pdf'], ['/abs.pdf'], ['a//b.pdf']])('bukti pelapor kosong atau path tidak sah (%s) = 404', async (path) => {
    const { r2 } = await pasang({ pengaduan: { data: { id: ID, jalur: 'layanan', lampiran_path: path }, error: null } });
    expect((await panggil()).status).toBe(404);
    expect(r2.presignGet).not.toHaveBeenCalled();
  });

  it('Front Office jalur layanan boleh', async () => {
    await pasang({ role: 'front_office' });
    expect((await panggil()).status).toBe(200);
  });

  it('Front Office jalur integritas = 403 (selaras RPC pengaduan)', async () => {
    const { r2 } = await pasang({ role: 'front_office', pengaduan: { data: { id: ID, jalur: 'integritas', lampiran_path: `${ID}/x.jpg` }, error: null } });
    expect((await panggil()).status).toBe(403);
    expect(r2.presignGet).not.toHaveBeenCalled();
  });

  it('Petugas dan staf nonaktif = 403; tanpa sesi = 401; tidak pernah menandatangani', async () => {
    for (const [p, status] of [[{ role: 'petugas' }, 403], [{ role: 'admin', aktif: false }, 403], [{ role: null }, 401]] as const) {
      vi.resetModules();
      const { r2 } = await pasang(p);
      expect((await panggil()).status).toBe(status);
      expect(r2.presignGet).not.toHaveBeenCalled();
    }
  });

  it('sesi sah diperiksa lewat klien sesi (sesi_valid) sebelum membaca dan menandatangani', async () => {
    const { rpc, r2 } = await pasang();
    expect((await panggil()).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('sesi_valid');
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(r2.presignGet).mock.invocationCallOrder[0]);
  });

  it.each([
    ['digantikan login baru (false)', { data: false, error: null }],
    ['idle/tidak dikenal (null)', { data: null, error: null }],
  ])('sesi %s = 401 SESI_TIDAK_SAH; pengaduan tidak dibaca, presignGet tidak dipanggil', async (_n, sesi) => {
    for (const query of ['', `?lampiran_id=${LAMPIRAN_ID}`]) {
      vi.resetModules();
      const { from, r2 } = await pasang({ role: 'front_office', sesi });
      const res = await panggil(query);
      expect(res.status).toBe(401);
      expect((await res.json()).kode).toBe('SESI_TIDAK_SAH');
      expect(from).not.toHaveBeenCalledWith('pengaduan');
      expect(from).not.toHaveBeenCalledWith('pengaduan_lampiran');
      expect(r2.presignGet).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['galat RPC', { data: null, error: { code: '08006', message: 'koneksi putus' } }],
    ['RPC melempar', async () => { throw new Error('jaringan'); }],
  ] as const)('pemeriksaan sesi gagal (%s) = 403 gagal-tertutup, presignGet tidak dipanggil', async (_n, sesi) => {
    const { from, r2 } = await pasang({ sesi: sesi as Pasang['sesi'] });
    expect((await panggil()).status).toBe(403);
    expect(from).not.toHaveBeenCalledWith('pengaduan');
    expect(r2.presignGet).not.toHaveBeenCalled();
  });

  it('pengaduan di luar lingkup RLS atau tidak ada = 404', async () => {
    const { r2 } = await pasang({ pengaduan: { data: null, error: null } });
    expect((await panggil()).status).toBe(404);
    expect(r2.presignGet).not.toHaveBeenCalled();
  });

  it('id bukan UUID = 404; lampiran_id bukan UUID = 400, tanpa query DB', async () => {
    const { from } = await pasang();
    expect((await panggil('', 'bukan-uuid')).status).toBe(404);
    expect((await panggil('?lampiran_id=xx')).status).toBe(400);
    expect(from).not.toHaveBeenCalledWith('pengaduan');
  });

  it('lampiran tanggapan: disaring id lampiran DAN pengaduan, lalu ditandatangani', async () => {
    const { r2 } = await pasang();
    const res = await panggil(`?lampiran_id=${LAMPIRAN_ID}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://r2.example/ditandatangani?sig=1' });
    expect(filter.pengaduan_lampiran).toEqual(expect.arrayContaining([['id', LAMPIRAN_ID], ['pengaduan_tanggapan.pengaduan_id', ID]]));
    expect(r2.presignGet).toHaveBeenCalledWith('private', `pengaduan-bukti/${ID}/${OBJ}.pdf`, 60);
  });

  it('lampiran tanggapan tidak ada atau kuncinya milik pengaduan lain = 404', async () => {
    for (const lampiran of [
      { data: null, error: null },
      { data: { id: LAMPIRAN_ID, kunci: `pengaduan-bukti/22222222-2222-4222-8222-222222222222/${OBJ}.pdf` }, error: null },
    ]) {
      vi.resetModules();
      const { r2 } = await pasang({ lampiran });
      expect((await panggil(`?lampiran_id=${LAMPIRAN_ID}`)).status).toBe(404);
      expect(r2.presignGet).not.toHaveBeenCalled();
    }
  });

  it('Front Office tidak bisa membuka lampiran tanggapan jalur integritas', async () => {
    const { r2 } = await pasang({ role: 'front_office', pengaduan: { data: { id: ID, jalur: 'integritas', lampiran_path: null }, error: null } });
    expect((await panggil(`?lampiran_id=${LAMPIRAN_ID}`)).status).toBe(403);
    expect(r2.presignGet).not.toHaveBeenCalled();
  });

  it('tabel lampiran belum ada (migrasi belum diterapkan) = 409 MIGRASI_BELUM_DITERAPKAN', async () => {
    await pasang({ lampiran: { data: null, error: { code: '42P01', message: 'relation "pengaduan_lampiran" does not exist' } } });
    const res = await panggil(`?lampiran_id=${LAMPIRAN_ID}`);
    expect(res.status).toBe(409);
    expect((await res.json()).kode).toBe('MIGRASI_BELUM_DITERAPKAN');
  });

  it('galat baca pengaduan = 500; R2 belum dikonfigurasi = 503; gagal menandatangani = 500', async () => {
    await pasang({ pengaduan: { data: null, error: { code: 'XX000', message: 'boom' } } });
    expect((await panggil()).status).toBe(500);

    vi.resetModules();
    const a = await pasang();
    vi.mocked(a.r2.r2Tersedia).mockReturnValue(false);
    expect((await panggil()).status).toBe(503);
    expect(a.r2.presignGet).not.toHaveBeenCalled();

    vi.resetModules();
    const b = await pasang();
    vi.mocked(b.r2.presignGet).mockRejectedValue(new Error('jaringan'));
    expect((await panggil()).status).toBe(500);
  });
});
