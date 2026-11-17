// @vitest-environment node
import ExcelJS from 'exceljs';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ createClient: vi.fn(), muatLingkup: vi.fn(), ambilSemuaDataPelayanan: vi.fn(),
  formLayanan: vi.fn(), muatFieldKhusus: vi.fn(), muatJawabanKhusus: vi.fn(), muatLayananEkspor: vi.fn(), getServiceClient: vi.fn(), insert: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/akun/server', () => ({ getServiceClient: mocks.getServiceClient }));
vi.mock('@/lib/rekap/terpaduServer', async original => ({ ...await original<typeof import('@/lib/rekap/terpaduServer')>(),
  muatLingkup: mocks.muatLingkup, ambilSemuaDataPelayanan: mocks.ambilSemuaDataPelayanan, formLayanan: mocks.formLayanan }));
vi.mock('@/lib/rekap/khususServer', () => ({ muatFieldKhusus: mocks.muatFieldKhusus, muatJawabanKhusus: mocks.muatJawabanKhusus }));
vi.mock('@/lib/rekap/exportServer', () => ({ muatLayananEkspor: mocks.muatLayananEkspor }));
const layananId = '660e8400-e29b-41d4-a716-446655440001';
const req = (query = '') => new NextRequest(`http://localhost/api/admin/rekap/terpadu/export?dari=2026-11-01&sampai=2026-11-16${query}`);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'auth' } } }) } });
  mocks.muatLingkup.mockResolvedValue({ ok: true, userId: 'auth', lingkup: { role: 'front_office', layanan_id: null } });
  mocks.ambilSemuaDataPelayanan.mockResolvedValue({ rows: [{ pelayanan_id: 'p1', sumber: 'penanganan', layanan_id: layananId,
    unit: 'layanan', layanan_nama: 'Layanan A', pengunjung_hp: '+6281234567890' }], truncated: false });
  mocks.formLayanan.mockResolvedValue(null);
  mocks.muatFieldKhusus.mockResolvedValue([]);
  mocks.muatLayananEkspor.mockResolvedValue([{ id: layananId, nama: 'Layanan A', form_pendataan: null, fields: [] }]);
  mocks.muatJawabanKhusus.mockResolvedValue(new Map());
  mocks.insert.mockResolvedValue({ error: null });
  mocks.getServiceClient.mockReturnValue({ from: () => ({ insert: mocks.insert }) });
});
async function baca(res: Response) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ExcelJS.Buffer);
  return wb;
}
describe('GET ekspor rekap G6', () => {
  it('pilihan semua: workbook Semua + layanan + Keterangan, audit sebelum berkas', async () => {
    const { GET } = await import('./route');
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await baca(res)).worksheets.map(s => s.name)).toEqual(['Semua', 'Layanan A', 'Keterangan']);
    expect(mocks.insert.mock.calls[0][0]).toMatchObject({ actor_id: 'auth', aksi: 'export_xlsx', detail: { multi_sheet: true, total_rows: 1 } });
  });
  it('pilihan satu layanan mempertahankan format lama, menyertakan jawaban + kolom nonaktif terakhir', async () => {
    const fields = [{ id: 'old', layanan_id: layananId, label: 'Nama baru', jenis: 'teks_singkat', urut: 0, tersembunyi: true, pernah_diisi: true },
      { id: 'active', layanan_id: layananId, label: 'Kosong', jenis: 'teks_singkat', urut: 9, tersembunyi: false }];
    mocks.muatFieldKhusus.mockResolvedValue(fields);
    mocks.muatJawabanKhusus.mockResolvedValue(new Map([['p1', { old: 'Jawaban lama' }]]));
    const { GET } = await import('./route');
    const res = await GET(req(`&layanan_id=${layananId}`));
    const wb = await baca(res);
    expect(wb.worksheets.map(s => s.name)).toEqual(['Data Pelayanan', 'Keterangan']);
    expect((wb.worksheets[0].getRow(1).values as unknown[]).slice(-2)).toEqual(['[Khusus] Kosong', '[Khusus] Nama baru (nonaktif)']);
    expect(wb.worksheets[0].getRow(2).values).toContain('Jawaban lama');
    expect(mocks.muatLayananEkspor).not.toHaveBeenCalled();
  });
  it('semua layanan menyertakan jawaban Khusus tiap layanan lewat klien pengguna', async () => {
    mocks.muatLayananEkspor.mockResolvedValue([{ id: layananId, nama: 'Khusus', form_pendataan: null,
      fields: [{ id: 'f', label: 'Terbaru', jenis: 'teks_singkat', urut: 1, tersembunyi: false }] }]);
    mocks.muatJawabanKhusus.mockResolvedValue(new Map([['p1', { f: 'Jawaban' }]]));
    const { GET } = await import('./route');
    const wb = await baca(await GET(req()));
    expect(wb.getWorksheet('Khusus')!.getRow(2).values).toContain('Jawaban');
    expect(mocks.muatJawabanKhusus).toHaveBeenCalledWith(await mocks.createClient.mock.results[0].value, ['p1']);
  });
  it.each(['null', 'error', 'throw'])('audit gagal %s harus 500 tanpa lampiran', async mode => {
    if (mode === 'null') mocks.getServiceClient.mockReturnValue(null);
    if (mode === 'error') mocks.insert.mockResolvedValue({ error: { message: 'Gagal' } });
    if (mode === 'throw') mocks.insert.mockRejectedValue(new Error('Gagal'));
    const { GET } = await import('./route');
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(res.headers.get('Content-Disposition')).toBeNull();
  });
  it('galat definisi tidak mengeluarkan workbook parsial', async () => {
    mocks.muatLayananEkspor.mockRejectedValue({ code: '57014', message: 'timeout' });
    const { GET } = await import('./route');
    expect((await GET(req())).status).toBe(500);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it('batas 50.000 diteruskan lewat header dan Keterangan', async () => {
    mocks.ambilSemuaDataPelayanan.mockResolvedValue({ rows: [], truncated: true });
    const { GET } = await import('./route');
    const res = await GET(req());
    expect(res.headers.get('X-Rekap-Truncated')).toBe('true');
    expect((await baca(res)).getWorksheet('Keterangan')?.getSheetValues().flat().join(' ')).toMatch(/terpotong/);
  });
});
