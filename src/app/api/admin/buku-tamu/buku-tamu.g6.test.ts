// @vitest-environment node
import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireStaf: vi.fn(), getServiceClient: vi.fn(), rpc: vi.fn(), from: vi.fn(), insert: vi.fn(), calls: [] as [string, unknown[]][] }));
vi.mock('@/lib/akun/server', () => ({ requireStaf: mocks.requireStaf, getServiceClient: mocks.getServiceClient,
  json: (b: unknown, status = 200) => NextResponse.json(b, { status }) }));
const tamu = {
  id: '660e8400-e29b-41d4-a716-446655440001', nama: '=CMD()', asal: 'CV Maju', no_hp: '+6281234567890',
  menemui_siapa: 'Kabid', keperluan: 'Konsultasi', waktu_masuk: '2026-11-16T02:00:00Z', waktu_keluar: null,
  menemui_petugas_id: null, dicatat_oleh: 'p1', pencatat: { nama: 'FO Satu' },
};
function chain(result: unknown) {
  let offset = 0;
  const b: unknown = new Proxy({}, { get(_t, k: string) {
    if (k === 'then') return (r: (v: unknown) => void) => r(offset > 0 && offset !== 10 ? { data: [], error: null } : result);
    return (...args: unknown[]) => { if (k === 'range') offset = Number(args[0]); mocks.calls.push([k, args]); return b; };
  } });
  return b;
}
function setup(role = 'front_office') {
  mocks.from.mockImplementation(() => chain({ data: [tamu], error: null, count: 1 }));
  mocks.rpc.mockResolvedValue({ data: { id: tamu.id, waktu_keluar: '2026-11-16T03:00:00Z' }, error: null });
  mocks.requireStaf.mockResolvedValue({ me: { id: 'p1', role }, user: { id: 'auth1' }, supabase: { from: mocks.from, rpc: mocks.rpc } });
  mocks.insert.mockResolvedValue({ error: null });
  mocks.getServiceClient.mockReturnValue({ from: () => ({ insert: mocks.insert }) });
}
const req = (path = '', method = 'GET', body?: unknown) => new NextRequest(`http://localhost/api/admin/buku-tamu${path}`, {
  method, ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
});
beforeEach(() => { vi.clearAllMocks(); mocks.calls.length = 0; setup(); });

describe('Buku Tamu G6 routes', () => {
  it('daftar tetap kompatibel, mengembalikan field keluar dan filter WIB/pencarian', async () => {
    const { GET } = await import('./route');
    const res = await GET(req('?dari=2026-11-01&sampai=2026-11-16&q=Maju&page=2&limit=10'));
    expect(res.status).toBe(200);
    expect((await res.json()).items[0]).toMatchObject({ waktu_keluar: null, menemui_petugas_id: null, instansi: 'CV Maju', dicatat_nama: 'FO Satu' });
    expect(mocks.calls).toContainEqual(['gte', ['waktu_masuk', '2026-11-01T00:00:00+07:00']]);
    expect(mocks.calls).toContainEqual(['range', [10, 19]]);
    expect(mocks.calls.some(([k, a]) => k === 'or' && String(a[0]).includes('Maju'))).toBe(true);
  });
  it.each(['?dari=2026-02-30', '?dari=2026-11-16&sampai=2026-11-01', '?dari=2020-01-01&sampai=2026-11-16'])('menolak rentang invalid %s', async path => {
    const { GET } = await import('./route');
    expect((await GET(req(path))).status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('PATCH memanggil RPC checkout dan hanya menerima field yang diizinkan', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(req('', 'PATCH', { id: tamu.id }));
    expect(res.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('buku_tamu_catat_keluar', { p_id: tamu.id, p_waktu_keluar: null });
    expect((await res.json()).tamu.waktu_keluar).toBe('2026-11-16T03:00:00Z');
    expect((await PATCH(req('', 'PATCH', { id: tamu.id, nama: 'Berubah' }))).status).toBe(400);
  });
  it.each([['TAMU_TIDAK_ADA: x', 404], ['WAKTU_TIDAK_VALID: x', 400], ['FORBIDDEN: x', 403], ['SESI_TIDAK_SAH: x', 401], ['audit gagal', 500]])('PATCH memetakan %s', async (message, status) => {
    mocks.rpc.mockResolvedValue({ error: { message } });
    const { PATCH } = await import('./route');
    expect((await PATCH(req('', 'PATCH', { id: tamu.id }))).status).toBe(status);
  });
  it.each(['front_office', 'admin'])('ekspor XLSX %s mempertahankan HP, kolom lengkap dan audit tanpa PII', async role => {
    setup(role);
    const { GET } = await import('./export/route');
    const res = await GET(req('/export?dari=2026-11-16&sampai=2026-11-16'));
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet('Buku Tamu')!;
    expect(ws.getRow(1).values).toEqual([undefined, 'Waktu masuk (WIB)', 'Waktu keluar (WIB)', 'Nama', 'Asal', 'HP', 'Keperluan', 'Menemui siapa', 'Dicatat oleh']);
    expect(ws.getRow(2).values).toContain("'+6281234567890");
    expect(mocks.insert.mock.calls[0][0]).toMatchObject({ actor_id: 'auth1', actor_role: role, aksi: 'export_xlsx', entitas: 'buku_tamu' });
    expect(JSON.stringify(mocks.insert.mock.calls)).not.toContain(tamu.no_hp);
  });
  it('CSV menetralkan formula dan memuat HP sebagai teks; q tidak disimpan pada audit', async () => {
    const { GET } = await import('./export/route');
    const res = await GET(req('/export?format=csv&q=Rahasia'));
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(await res.text()).toContain("'=CMD()");
    expect(res.headers.get('X-Rekap-Truncated')).toBe('false');
    expect(JSON.stringify(mocks.insert.mock.calls)).not.toContain('Rahasia');
  });
  it.each(['null', 'error', 'throw'])('ekspor fail-closed bila audit %s', async mode => {
    if (mode === 'null') mocks.getServiceClient.mockReturnValue(null);
    if (mode === 'error') mocks.insert.mockResolvedValue({ error: { message: 'gagal' } });
    if (mode === 'throw') mocks.insert.mockRejectedValue(new Error('gagal'));
    const { GET } = await import('./export/route');
    const res = await GET(req('/export?format=csv'));
    expect(res.status).toBe(500);
    expect(res.headers.get('Content-Disposition')).toBeNull();
  });
  it('petugas dan anonim ditolak pada daftar/checkout/ekspor', async () => {
    setup('petugas');
    const { GET, PATCH } = await import('./route');
    const { GET: ekspor } = await import('./export/route');
    expect((await GET(req())).status).toBe(403);
    expect((await PATCH(req('', 'PATCH', { id: tamu.id }))).status).toBe(403);
    expect((await ekspor(req('/export'))).status).toBe(403);
    mocks.requireStaf.mockResolvedValue({ res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
    expect((await ekspor(req('/export'))).status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
