import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catatKeluar, catatTamu, muatBukuTamu, paramFilter, unduhBukuTamu } from './buku-tamu';

const F = { dari: '2026-10-01', sampai: '2026-10-08', q: ' Dinas ' };
let fetchMock: ReturnType<typeof vi.fn>;
const res = (o: { ok?: boolean; status?: number; json?: unknown; headers?: Record<string, string> }) => ({
  ok: o.ok ?? true,
  status: o.status ?? 200,
  json: () => (o.json === undefined ? Promise.reject(new Error('bukan json')) : Promise.resolve(o.json)),
  blob: () => Promise.resolve(new Blob(['x'])),
  headers: new Headers(o.headers),
});

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('paramFilter', () => {
  it('q dipangkas dan hanya dikirim bila ada', () => {
    expect(paramFilter(F).toString()).toBe('dari=2026-10-01&sampai=2026-10-08&q=Dinas');
    expect(paramFilter({ ...F, q: '  ' }).toString()).toBe('dari=2026-10-01&sampai=2026-10-08');
  });
});

describe('muatBukuTamu', () => {
  it('halaman 1-based + limit; bentuk respons diteruskan', async () => {
    fetchMock.mockResolvedValue(res({ json: { items: [{ id: 'a' }], total: 7 } }));
    const h = await muatBukuTamu(F, 3);
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/admin/buku-tamu?dari=2026-10-01&sampai=2026-10-08&q=Dinas&page=3&limit=50');
    expect(h).toEqual({ data: { items: [{ id: 'a' }], total: 7 }, error: null });
  });

  it('galat server memakai pesannya; tanpa pesan memakai cadangan; jaringan putus tidak melempar', async () => {
    fetchMock.mockResolvedValueOnce(res({ ok: false, status: 500, json: { error: 'Gagal memuat buku tamu' } }));
    expect(await muatBukuTamu(F, 1)).toEqual({ data: null, error: 'Gagal memuat buku tamu' });
    fetchMock.mockResolvedValueOnce(res({ ok: false, status: 502 }));
    expect(await muatBukuTamu(F, 1)).toEqual({ data: null, error: 'Gagal memuat buku tamu' });
    fetchMock.mockRejectedValueOnce(new TypeError('x'));
    expect((await muatBukuTamu(F, 1)).error).toMatch(/Tidak dapat menghubungi server/);
  });
});

describe('catatTamu dan catatKeluar', () => {
  it('POST membawa badan; PATCH hanya id', async () => {
    fetchMock.mockResolvedValue(res({ json: { tamu: { id: 't' } } }));
    await catatTamu({ nama: 'A', instansi: 'B', no_hp: '08', bertemu: 'C', menemui_petugas_id: 'p' });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ menemui_petugas_id: 'p' });
    await catatKeluar('t');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'PATCH', body: '{"id":"t"}' });
  });

  it('galat server diteruskan sebagai pesan', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 404, json: { error: 'Tamu tidak ditemukan' } }));
    expect(await catatKeluar('t')).toEqual({ data: null, error: 'Tamu tidak ditemukan' });
  });
});

describe('unduhBukuTamu', () => {
  it('berhasil: nama dari Content-Disposition, terpotong dari X-Rekap-Truncated', async () => {
    fetchMock.mockResolvedValue(res({ headers: { 'Content-Disposition': 'attachment; filename="bt.csv"', 'X-Rekap-Truncated': 'true' } }));
    const h = await unduhBukuTamu(F, 'csv');
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/admin/buku-tamu/export?dari=2026-10-01&sampai=2026-10-08&q=Dinas&format=csv');
    expect(h.error).toBeNull();
    expect(h.data).toMatchObject({ nama: 'bt.csv', terpotong: true });
  });

  it('tanpa header: nama cadangan dan tidak terpotong', async () => {
    fetchMock.mockResolvedValue(res({}));
    const h = await unduhBukuTamu({ ...F, q: '' }, 'xlsx');
    expect(h.data).toMatchObject({ nama: 'buku-tamu-2026-10-01-sd-2026-10-08.xlsx', terpotong: false });
  });

  it('500 tanpa pesan: galat audit/berkas yang jelas; 4xx dengan pesan server', async () => {
    fetchMock.mockResolvedValueOnce(res({ ok: false, status: 500 }));
    expect((await unduhBukuTamu(F, 'xlsx')).error).toMatch(/Unduhan dibatalkan/);
    fetchMock.mockResolvedValueOnce(res({ ok: false, status: 400, json: { error: 'Rentang tanggal tidak valid' } }));
    expect((await unduhBukuTamu(F, 'xlsx')).error).toBe('Rentang tanggal tidak valid');
  });
});
