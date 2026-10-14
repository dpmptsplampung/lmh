// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import { GET } from './route';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/akun/server', () => ({ getServiceClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { getServiceClient } from '@/lib/akun/server';

function buildMock(opts: {
  role: string;
  layananId: string | null;
  rows?: unknown[];
}) {
  const total = opts.rows?.length ?? 0;
  // Single shared thenable builder — tolerates arbitrary chained order and awaits
  // with the canned response. Mirrors Task 8's permissive pattern.
  const builder: Record<string, unknown> = {};
  const response = { data: opts.rows ?? [], count: total, error: null };
  const noopChain = vi.fn(() => builder);
  builder.eq = noopChain;
  builder.gte = noopChain;
  builder.lte = noopChain;
  builder.order = noopChain;
  builder.range = noopChain;
  builder.or = noopChain;
  builder.limit = noopChain;
  builder.ilike = noopChain;
  (builder as unknown as { then: unknown }).then = (
    resolve: (v: unknown) => void,
  ) => resolve(response);
  const select = vi.fn(() => builder);

  const maybeSingle = vi.fn().mockResolvedValue({
    data: { id: 'p-1', role: opts.role, layanan_id: opts.layananId, aktif: true },
    error: null,
  });
  const eqP = vi.fn().mockReturnValue({ maybeSingle });
  const selectP = vi.fn().mockReturnValue({ eq: eqP });

  const insert = vi.fn().mockResolvedValue({ error: null });
  const auditFrom = { insert };

  // Layanan lookup mock — returns null by default; tests can override via second arg
  const layananMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  const layananEq = vi.fn().mockReturnValue({ maybeSingle: layananMaybeSingle });
  const layananSelect = vi.fn().mockReturnValue({ eq: layananEq });
  const layananFrom = { select: layananSelect };

  return {
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null }),
    },
    from: vi.fn((t: string) => {
      if (t === 'petugas') return { select: selectP };
      if (t === 'audit_log') return auditFrom;
      if (t === 'layanan') return layananFrom;
      return { select };
    }),
  };
}

describe('GET /api/admin/rekap/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // audit_log ditulis lewat service role (pengguna tidak punya INSERT langsung).
    (getServiceClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      from: () => ({ insert: vi.fn().mockResolvedValue({ error: null }) }),
    });
  });

  it('returns 401 when not authenticated', async () => {
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: {
        getUser: vi
          .fn()
          .mockResolvedValue({ data: { user: null }, error: null }),
      },
      from: vi.fn(),
    });
    const res = await GET(
      new NextRequest('http://localhost/api/admin/rekap/export'),
    );
    expect(res.status).toBe(401);
  });

  it('returns xlsx for admin with empty rows', async () => {
    const mock = buildMock({ role: 'admin', layananId: null, rows: [] });
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mock,
    );
    const res = await GET(
      new NextRequest('http://localhost/api/admin/rekap/export'),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('spreadsheetml.sheet');
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it('returns the workbook when audit_log insert fails', async () => {
    const mock = buildMock({ role: 'admin', layananId: null, rows: [] });
    const auditError = { message: 'RLS denied' };
    const auditInsert = vi.fn().mockResolvedValue({ error: auditError });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    (getServiceClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      from: (table: string) => (table === 'audit_log' ? { insert: auditInsert } : undefined),
    });
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mock);

    const res = await GET(new NextRequest('http://localhost/api/admin/rekap/export'));

    expect(res.status).toBe(200);
    expect(auditInsert).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith(
      '[api/admin/rekap/export] audit_log insert gagal:',
      auditError,
    );
  });

  it('returns 403 for petugas accessing other layanan', async () => {
    const mock = buildMock({ role: 'petugas', layananId: 'svc-oss', rows: [] });
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mock,
    );
    const url =
      'http://localhost/api/admin/rekap/export?layanan_id=550e8400-e29b-41d4-a716-446655440000';
    const res = await GET(new NextRequest(url));
    expect(res.status).toBe(403);
  });

  it.each([
    ['umum', 'rekap_harian_layanan'],
    ['oss', 'v_rekap_pelayanan_oss'],
    ['perizinan', 'v_rekap_pelayanan_perizinan'],
  ] as const)('uses %s recap source for tab=%s', async (tab, source) => {
    const mock = buildMock({ role: 'petugas', layananId: 'svc-oss', rows: [] });
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mock);
    const res = await GET(new NextRequest('http://localhost/api/admin/rekap/export?tab=' + tab + '&dari=2026-09-01&sampai=2026-09-30'));
    expect(res.status).toBe(200);
    expect(mock.from).toHaveBeenCalledWith(source);
  });

  it('defaults tab to layanan and retains ticket export behavior', async () => {
    const mock = buildMock({ role: 'petugas', layananId: 'svc-oss', rows: [] });
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mock);
    const res = await GET(new NextRequest('http://localhost/api/admin/rekap/export?dari=2026-09-01&sampai=2026-09-30'));
    expect(res.status).toBe(200);
    expect(mock.from).toHaveBeenCalledWith('tiket_antrean');
  });

  it.each([
    ['oss', 'v_rekap_pelayanan_oss', 'Helpdesk OSS'],
    ['perizinan', 'v_rekap_pelayanan_perizinan', 'Non OSS'],
  ] as const)('tab=%s: kolom Front Office dari tahap FO kunjungan tiket; tiket lama tanpa tahap FO tampil em dash', async (tab, source, sheet) => {
    const viewRows = [
      { id: 'v1', tiket_id: 't-baru', nomor_display: 'OS-001', tanggal: '2026-09-02', nama_pemohon: 'Budi', nama_petugas: 'Rina', status_draft: 'final' },
      { id: 'v2', tiket_id: 't-lama', nomor_display: 'OS-002', tanggal: '2026-09-02', nama_pemohon: 'Siti', nama_petugas: 'Rina', status_draft: 'final' },
    ];
    const tiketRows = [
      { id: 't-baru', kunjungan: { tahap_fo: [
        { tahap_ke: 1, peran_tahap: 'fo', penangan_id: 'fo-a', petugas: { nama: 'Ani FO' } },
        { tahap_ke: 2, peran_tahap: 'layanan', penangan_id: 'p-1', petugas: { nama: 'Rina' } },
      ] } },
      { id: 't-lama', kunjungan: { tahap_fo: [] } },
    ];
    const inFn = vi.fn();
    const viewBuilder: Record<string, unknown> = {};
    for (const m of ['select', 'gte', 'lte', 'order']) viewBuilder[m] = () => viewBuilder;
    viewBuilder.then = (res: (v: unknown) => unknown) => res({ data: viewRows, error: null });
    const tiketBuilder: Record<string, unknown> = {};
    tiketBuilder.select = () => tiketBuilder;
    tiketBuilder.in = (...a: unknown[]) => { inFn(...a); return Promise.resolve({ data: tiketRows, error: null }); };
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: 'p-1', role: 'admin', layanan_id: null, aktif: true }, error: null });
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null }) },
      from: (t: string) => {
        if (t === 'petugas') return { select: () => ({ eq: () => ({ maybeSingle }) }) };
        if (t === 'tiket_antrean') return tiketBuilder;
        if (t === source) return viewBuilder;
        throw new Error('tabel tak terduga ' + t);
      },
    });
    const res = await GET(new NextRequest(`http://localhost/api/admin/rekap/export?tab=${tab}&dari=2026-09-01&sampai=2026-09-30`));
    expect(res.status).toBe(200);
    expect(inFn).toHaveBeenCalledWith('id', ['t-baru', 't-lama']);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet(sheet)!;
    const header = (ws.getRow(1).values as unknown[]).slice(1) as string[];
    const kolom = header.indexOf('Front Office') + 1;
    expect(kolom).toBe(header.indexOf('Petugas') + 2);
    expect([ws.getRow(2).getCell(kolom).value, ws.getRow(3).getCell(kolom).value]).toEqual(['Ani FO', '—']);
  });

  it('tab=oss: gagal memuat FO tidak menggagalkan ekspor (kolom FO em dash)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const viewBuilder: Record<string, unknown> = {};
    for (const m of ['select', 'gte', 'lte', 'order']) viewBuilder[m] = () => viewBuilder;
    viewBuilder.then = (res: (v: unknown) => unknown) => res({ data: [{ id: 'v1', tiket_id: 't-1', nomor_display: 'OS-001', nama_petugas: 'Rina' }], error: null });
    const tiketBuilder: Record<string, unknown> = { select: () => tiketBuilder, in: () => Promise.resolve({ data: null, error: { message: 'rls' } }) };
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: 'p-1', role: 'admin', layanan_id: null, aktif: true }, error: null });
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null }) },
      from: (t: string) => (t === 'petugas' ? { select: () => ({ eq: () => ({ maybeSingle }) }) } : t === 'tiket_antrean' ? tiketBuilder : viewBuilder),
    });
    const res = await GET(new NextRequest('http://localhost/api/admin/rekap/export?tab=oss'));
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Helpdesk OSS')!;
    const header = (ws.getRow(1).values as unknown[]).slice(1) as string[];
    expect(ws.getRow(2).getCell(header.indexOf('Front Office') + 1).value).toBe('—');
    errorSpy.mockRestore();
  });
});
