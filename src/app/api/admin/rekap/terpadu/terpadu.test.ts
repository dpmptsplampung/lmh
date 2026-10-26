// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import { GET } from './route';
import { GET as GET_EXPORT } from './export/route';
import { ambilSemuaDataPelayanan } from '@/lib/rekap/terpaduServer';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/akun/server', () => ({ getServiceClient: vi.fn() }));
import { createClient } from '@/lib/supabase/server';
import { getServiceClient } from '@/lib/akun/server';

type Hasil = { data: unknown; error: unknown; count?: number | null };
const thenable = (r: Hasil) => Object.assign(Promise.resolve(r), { range: vi.fn(() => Promise.resolve(r)) });

const LINGKUP_BIASA = { petugas_id: 'p1', role: 'front_office', koordinator: false, layanan_id: null, layanan_nama: null };

function pasang(opsi: { user?: unknown; rpc?: Record<string, Hasil>; layanan?: Hasil }) {
  const rpc = vi.fn((nama: string, _args?: Record<string, unknown>) => thenable(opsi.rpc?.[nama] ?? { data: null, error: null }));
  const eqLayanan = vi.fn();
  const pembangunLayanan = {
    order: vi.fn(() => pembangunLayanan),
    eq: vi.fn((...a: unknown[]) => { eqLayanan(...a); return pembangunLayanan; }),
    maybeSingle: vi.fn(() => Promise.resolve({ data: { form_pendataan: 'oss' }, error: null })),
    then: (res: (v: Hasil) => unknown) => Promise.resolve(opsi.layanan ?? { data: [], error: null }).then(res),
  };
  const klien = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: 'user' in opsi ? opsi.user : { id: 'u1' } } }) },
    rpc,
    from: vi.fn(() => ({ select: vi.fn(() => pembangunLayanan) })),
  };
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(klien);
  return { rpc, eqLayanan };
}

const get = (qs: string) => GET(new NextRequest(`http://localhost/api/admin/rekap/terpadu?${qs}`));
const getExport = (qs: string) => GET_EXPORT(new NextRequest(`http://localhost/api/admin/rekap/terpadu/export?${qs}`));

const baris = {
  pelayanan_id: 'x1', sumber: 'penanganan', tanggal: '2026-10-20', unit: 'fo', layanan_id: null, layanan_nama: null,
  kanal: 'tatap_muka', penangan_id: 'p1', penangan_nama: 'Sari', pengunjung_nama: 'Andi', pengunjung_hp: '0812',
};

describe('GET /api/admin/rekap/terpadu', () => {
  beforeEach(() => vi.clearAllMocks());

  it('401 bila belum masuk (juga untuk query tidak valid)', async () => {
    pasang({ user: null });
    expect((await get('bagian=harian')).status).toBe(401);
    expect((await get('bagian=salah')).status).toBe(401);
  });

  it('401 bila bukan staf aktif (lingkup_data_saya null)', async () => {
    pasang({ rpc: { lingkup_data_saya: { data: null, error: null } } });
    expect((await get('bagian=harian')).status).toBe(401);
  });

  it('409 MIGRASI_BELUM_DITERAPKAN bila RPC belum ada', async () => {
    pasang({ rpc: { lingkup_data_saya: { data: null, error: { code: 'PGRST202', message: 'not found' } } } });
    const res = await get('bagian=harian');
    expect(res.status).toBe(409);
    expect((await res.json()).kode).toBe('MIGRASI_BELUM_DITERAPKAN');
  });

  it('422 untuk query tidak valid (kunci asing tidak bisa memperluas lingkup)', async () => {
    pasang({ rpc: { lingkup_data_saya: { data: LINGKUP_BIASA, error: null } } });
    expect((await get('bagian=data&petugas_id=00000000-0000-4000-8000-000000000000')).status).toBe(422);
    expect((await get('bagian=data&dari=2026-10-05&sampai=2026-10-01')).status).toBe(422);
  });

  it('lingkup: FO biasa hanya unit Front Office, tanpa opsi Layanan, label "Hanya data … sendiri"', async () => {
    const { rpc } = pasang({ rpc: { lingkup_data_saya: { data: LINGKUP_BIASA, error: null } } });
    const body = await (await get('bagian=lingkup')).json();
    expect(body.unit_opsi).toEqual(['fo']);
    expect(body.opsi_layanan).toEqual([]);
    expect(body.label).toBe('Hanya data yang Anda tangani sendiri.');
    expect(rpc).toHaveBeenCalledWith('lingkup_data_saya');
  });

  it('lingkup: Petugas hanya Layanannya sendiri sebagai opsi', async () => {
    const { eqLayanan } = pasang({
      rpc: { lingkup_data_saya: { data: { ...LINGKUP_BIASA, role: 'petugas', koordinator: true, layanan_id: 'L1', layanan_nama: 'OSS' }, error: null } },
      layanan: { data: [{ id: 'L1', nama: 'OSS', form_pendataan: 'oss' }], error: null },
    });
    const body = await (await get('bagian=lingkup')).json();
    expect(eqLayanan).toHaveBeenCalledWith('id', 'L1');
    expect(body.unit_opsi).toEqual(['layanan']);
    expect(body.opsi_layanan).toHaveLength(1);
  });

  it('harian: agregat dari DB (rows + ringkasan dalam satu jsonb), filter unit/layanan diteruskan ke DB', async () => {
    const { rpc } = pasang({
      rpc: {
        lingkup_data_saya: { data: { ...LINGKUP_BIASA, role: 'admin' }, error: null },
        rekap_harian_terpadu: {
          data: {
            rows: [{ tanggal: '2026-10-20', unit: 'fo', tatap_muka: 2, live_chat: 1, jumlah: 3 }],
            // Ringkasan dihitung DB atas semua baris (bukan dari baris yang dikirim): angka ini sengaja lebih besar.
            ringkasan: { jumlah: '1500', tatap_muka: 1400, live_chat: 100, per_unit: [{ nama: 'Front Office', jumlah: 1500 }] },
          },
          error: null,
        },
      },
    });
    const body = await (await get('bagian=harian&dari=2026-10-14&sampai=2026-10-20&unit=fo')).json();
    expect(rpc).toHaveBeenCalledWith('rekap_harian_terpadu', { p_dari: '2026-10-14', p_sampai: '2026-10-20', p_unit: 'fo', p_layanan_id: null });
    expect(body.rows).toHaveLength(1);
    expect(body.ringkasan).toEqual({ jumlah: 1500, tatap_muka: 1400, live_chat: 100, per_unit: [{ nama: 'Front Office', jumlah: 1500 }] });
  });

  it('data: satu halaman dari DB (p_batas/p_lewati, total dari DB, tanpa count PostgREST); 422 RENTANG_TIDAK_VALID', async () => {
    const { rpc } = pasang({
      rpc: {
        lingkup_data_saya: { data: LINGKUP_BIASA, error: null },
        rekap_data_pelayanan: { data: { total: 31, rows: [baris], berikut: null }, error: null },
      },
    });
    const body = await (await get('bagian=data&dari=2026-10-14&sampai=2026-10-20&page=1&page_size=10')).json();
    expect(rpc).toHaveBeenCalledWith('rekap_data_pelayanan', {
      p_dari: '2026-10-14', p_sampai: '2026-10-20', p_unit: null, p_layanan_id: null,
      p_batas: 10, p_lewati: 10, p_setelah: null, p_hitung: true,
    });
    expect(rpc.mock.calls.every((c) => c.length < 3)).toBe(true);
    expect(body.total).toBe(31);
    expect(body.rows[0].pengunjung_nama).toBe('Andi');

    pasang({
      rpc: {
        lingkup_data_saya: { data: LINGKUP_BIASA, error: null },
        rekap_data_pelayanan: { data: null, error: { code: '22023', message: 'RENTANG_TIDAK_VALID: x' } },
      },
    });
    const res = await get('bagian=data');
    expect(res.status).toBe(422);
    expect((await res.json()).kode).toBe('RENTANG_TIDAK_VALID');
  });

  it('kinerja: memanggil rekap_kinerja_petugas (jsonb rows)', async () => {
    const { rpc } = pasang({
      rpc: {
        lingkup_data_saya: { data: LINGKUP_BIASA, error: null },
        rekap_kinerja_petugas: { data: { rows: [{ penangan_id: 'p1', unit: 'fo', jumlah: '4', live_chat: '1', rata_durasi_menit: '7.5' }] }, error: null },
      },
    });
    const body = await (await get('bagian=kinerja&unit=fo')).json();
    expect(rpc).toHaveBeenCalledWith('rekap_kinerja_petugas', expect.objectContaining({ p_unit: 'fo' }));
    expect(body.rows[0]).toMatchObject({ jumlah: 4, live_chat: 1, rata_durasi_menit: 7.5 });
  });
});

describe('GET /api/admin/rekap/terpadu/export', () => {
  const auditInsert = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    auditInsert.mockResolvedValue({ error: null });
    (getServiceClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      from: (t: string) => (t === 'audit_log' ? { insert: auditInsert } : undefined),
    });
  });

  it('401 tanpa sesi; 409 bila migrasi belum ada', async () => {
    pasang({ user: null });
    expect((await getExport('dari=2026-10-01&sampai=2026-10-02')).status).toBe(401);
    pasang({ rpc: { lingkup_data_saya: { data: null, error: { code: '42883', message: 'x' } } } });
    expect((await getExport('dari=2026-10-01&sampai=2026-10-02')).status).toBe(409);
  });

  it('berkas Excel dari RPC dengan paging keyset (bukan service-role) + audit_log export_xlsx', async () => {
    const { rpc } = pasang({ rpc: { lingkup_data_saya: { data: LINGKUP_BIASA, error: null } } });
    const kunci = { tanggal: '2026-10-20', urut: '2026-10-20T02:00:00+00:00', id: 'x1' };
    rpc.mockImplementation((nama: string, args?: Record<string, unknown>) => {
      if (nama === 'lingkup_data_saya') return thenable({ data: LINGKUP_BIASA, error: null });
      return thenable(args?.p_setelah
        ? { data: { total: null, rows: [{ ...baris, pelayanan_id: 'x2' }], berikut: null }, error: null }
        : { data: { total: null, rows: [baris], berikut: kunci }, error: null });
    });
    const res = await getExport('dari=2026-10-01&sampai=2026-10-31&unit=fo');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('data-pelayanan-2026-10-01-sd-2026-10-31.xlsx');
    expect(res.headers.get('X-Rekap-Truncated')).toBe('false');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
    expect(wb.getWorksheet('Data Pelayanan')!.rowCount).toBe(3);
    const panggilanData = rpc.mock.calls.filter(([n]) => n === 'rekap_data_pelayanan');
    expect(panggilanData).toHaveLength(2);
    expect(panggilanData[0][1]).toMatchObject({ p_unit: 'fo', p_batas: 1000, p_setelah: null, p_hitung: false });
    expect(panggilanData[1][1]).toMatchObject({ p_setelah: kunci });
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      aksi: 'export_xlsx', entitas: 'rekap_data_pelayanan', actor_role: 'front_office',
      detail: expect.objectContaining({ total_rows: 2, unit: 'fo', koordinator: false }),
    }));
  });
});

describe('ambilSemuaDataPelayanan', () => {
  it('tidak memotong diam-diam: melewati batas -> truncated true dan dipangkas ke batas', async () => {
    let n = 0;
    const supabase = {
      rpc: vi.fn(async () => {
        n += 1;
        return { data: { rows: [{ pelayanan_id: `a${n}` }, { pelayanan_id: `b${n}` }], berikut: { id: `b${n}` } }, error: null };
      }),
    };
    const hasil = await ambilSemuaDataPelayanan(supabase as never, { p_dari: 'x', p_sampai: 'y', p_unit: null, p_layanan_id: null }, 3);
    expect(hasil.truncated).toBe(true);
    expect(hasil.rows).toHaveLength(3);
  });

  it('berhenti saat berikut null; galat RPC dilempar', async () => {
    const satu = { rpc: vi.fn(async () => ({ data: { rows: [{ pelayanan_id: 'a' }], berikut: null }, error: null })) };
    expect(await ambilSemuaDataPelayanan(satu as never, { p_dari: 'x', p_sampai: 'y', p_unit: null, p_layanan_id: null }))
      .toEqual({ rows: [{ pelayanan_id: 'a' }], truncated: false });
    const galat = { rpc: vi.fn(async () => ({ data: null, error: { code: '22023', message: 'RENTANG_TIDAK_VALID' } })) };
    await expect(ambilSemuaDataPelayanan(galat as never, { p_dari: 'x', p_sampai: 'y', p_unit: null, p_layanan_id: null }))
      .rejects.toMatchObject({ code: '22023' });
  });
});
