// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { GET } from './route';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

type Hasil = { data: unknown; error: unknown };
const LID = '660e8400-e29b-41d4-a716-446655440001';
const FID = '770e8400-e29b-41d4-a716-446655440002';
const LINGKUP = { petugas_id: 'p1', role: 'petugas', koordinator: false, layanan_id: LID };
const FIELD = {
  id: FID, layanan_id: LID, label: 'Jenis kartu', jenis: 'pilihan_tunggal', wajib: true,
  opsi: ['A', 'B'], urut: 0, tersembunyi: false, pernah_diisi: true,
};
const BARIS = {
  pelayanan_id: 'p1', sumber: 'penanganan', tanggal: '2026-11-01', unit: 'layanan', layanan_id: LID,
  layanan_nama: 'BPJS', kanal: 'live_chat', pengunjung_nama: 'Andi', pengunjung_hp: '0812',
};
const DATA: Hasil = { data: { total: '31', rows: [BARIS, { ...BARIS, pelayanan_id: 't1', sumber: 'tiket_lama' }] }, error: null };
const RINGKASAN: Hasil = { data: { saya: 5, total: 20, persen: 25 }, error: null };

function tahan<T>() {
  let lepas!: (hasil: T) => void;
  let tolak!: (error: unknown) => void;
  const janji = new Promise<T>((resolve, reject) => { lepas = resolve; tolak = reject; });
  return { janji, lepas, tolak };
}

function pasang(opsi: {
  data?: Promise<Hasil>;
  lingkup?: Promise<Hasil>;
  ringkasan?: Promise<Hasil>;
  field?: Promise<Hasil>;
  form?: Promise<Hasil>;
  jawaban?: Promise<Hasil>;
} = {}) {
  const field = vi.fn(() => opsi.field ?? Promise.resolve({ data: [FIELD], error: null }));
  const form = vi.fn(() => opsi.form ?? Promise.resolve({ data: { form_pendataan: 'oss' }, error: null }));
  const rpc = vi.fn((nama: string, _arg?: Record<string, unknown>) => {
    if (nama === 'lingkup_data_saya') return opsi.lingkup ?? Promise.resolve({ data: LINGKUP, error: null });
    if (nama === 'rekap_data_pelayanan') return opsi.data ?? Promise.resolve(DATA);
    if (nama === 'rekap_ringkasan_dilayani') return opsi.ringkasan ?? Promise.resolve(RINGKASAN);
    if (nama === 'pendataan_khusus_peta') return opsi.jawaban ?? Promise.resolve({ data: { p1: { [FID]: 'B' } }, error: null });
    throw new Error(`RPC tidak terduga: ${nama}`);
  });
  const from = vi.fn((tabel: string) => {
    const b = {
      select: () => b, eq: () => b, order: () => b,
      maybeSingle: form,
      then: (resolve: (v: Hasil) => unknown, reject?: (e: unknown) => unknown) => field().then(resolve, reject),
    };
    if (!['pendataan_khusus_field', 'layanan'].includes(tabel)) throw new Error(`Tabel tidak terduga: ${tabel}`);
    return b;
  });
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) }, rpc, from,
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  return { rpc, from, field, form };
}

const get = (tambahan = '') => GET(new NextRequest(
  `http://localhost/api/admin/rekap/terpadu?bagian=data&layanan_id=${LID}&dari=2026-11-01&sampai=2026-11-03${tambahan}`,
));

describe('rekap data: pemuatan paralel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('memulai definisi dan formulir saat RPC ditahan, lalu mempertahankan isi respons dan semua langkah Server-Timing', async () => {
    const data = tahan<Hasil>();
    const { rpc, field, form } = pasang({ data: data.janji });
    const respons = get();
    try {
      await vi.waitFor(() => {
        expect(rpc).toHaveBeenCalledWith('rekap_data_pelayanan', expect.anything());
        expect(field).toHaveBeenCalledOnce();
        expect(form).toHaveBeenCalledOnce();
      });
      expect(rpc.mock.calls.map(([nama]) => nama)).not.toContain('pendataan_khusus_peta');
    } finally {
      data.lepas(DATA);
    }
    const res = await respons;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      dilayani: { saya: 5, total: 20, persen: 25 }, total: 31, form_type: 'oss', kolom_khusus: [FIELD],
      rows: [
        {
          ...BARIS, kunjungan_id: null, tiket_id: null, nomor_tiket: null, penangan_id: null, penangan_nama: null,
          fo_nama: null, hasil: null, topik: null, catatan: null, mulai_at: null, selesai_at: null,
          pengunjung_email: null, pengunjung_instansi: null, pengunjung_kategori: null, keperluan: null,
          form_type: null, pendataan: null, khusus: { [FID]: 'B' },
        },
        {
          ...BARIS, pelayanan_id: 't1', sumber: 'tiket_lama', kunjungan_id: null, tiket_id: null, nomor_tiket: null,
          penangan_id: null, penangan_nama: null, fo_nama: null, hasil: null, topik: null, catatan: null,
          mulai_at: null, selesai_at: null, pengunjung_email: null, pengunjung_instansi: null,
          pengunjung_kategori: null, keperluan: null, form_type: null, pendataan: null,
        },
      ],
    });
    expect(rpc).toHaveBeenCalledWith('pendataan_khusus_peta', { p_penanganan: ['p1'] });
    const langkah = res.headers.get('Server-Timing')!.split(', ').map((v) => v.split(';dur=')[0]);
    expect(langkah.sort()).toEqual(['lingkup', 'ringkasan', 'rpc_data', 'field_khusus', 'jawaban_khusus', 'form_layanan'].sort());
    expect(res.headers.get('Server-Timing')).toMatch(/(?:^|, )[a-z_]+;dur=\d+(?:\.\d+)?/);
  });

  it.each([
    ['ringkasan', { message: 'FORBIDDEN: ringkasan' }, { message: 'RENTANG_TIDAK_VALID: RPC' }, { message: 'UNIT_TIDAK_VALID: field' }, 403,
      { error: 'Anda tidak berhak membaca rekap ini.', kode: 'FORBIDDEN' }],
    ['RPC', null, { message: 'RENTANG_TIDAK_VALID: RPC' }, { message: 'UNIT_TIDAK_VALID: field' }, 422,
      { error: 'RPC', kode: 'RENTANG_TIDAK_VALID' }],
    ['definisi', null, null, { message: 'UNIT_TIDAK_VALID: field' }, 422,
      { error: 'field', kode: 'UNIT_TIDAK_VALID' }],
    ['jawaban', null, null, null, 401,
      { error: 'Sesi Anda tidak berlaku lagi. Silakan masuk kembali.', kode: 'SESI_TIDAK_SAH' }],
  ] as const)('mempertahankan prioritas galat %s meski formulir menolak lebih dulu', async (
    tahap, galatRingkasan, galatData, galatField, status, body,
  ) => {
    const data = tahan<Hasil>();
    const form = tahan<Hasil>();
    const { rpc, field, form: mulaiForm } = pasang({
      data: data.janji, form: form.janji,
      ringkasan: Promise.resolve(galatRingkasan ? { data: null, error: galatRingkasan } : RINGKASAN),
      field: Promise.resolve({ data: [FIELD], error: galatField }),
      jawaban: Promise.resolve({ data: null, error: { message: 'SESI_TIDAK_SAH: jawaban' } }),
    });
    const respons = get();
    await vi.waitFor(() => {
      expect(field).toHaveBeenCalledOnce();
      expect(mulaiForm).toHaveBeenCalledOnce();
    });
    form.tolak(new Error('transport formulir gagal'));
    data.lepas(galatData ? { data: null, error: galatData } : DATA);
    const res = await respons;
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
    expect(res.headers.get('Server-Timing')).toBeNull();
    expect(rpc.mock.calls.some(([nama]) => nama === 'pendataan_khusus_peta')).toBe(tahap === 'jawaban');
  });

  it('tetap melempar galat transport formulir setelah definisi dan jawaban berhasil', async () => {
    const form = tahan<Hasil>();
    const galat = new Error('transport formulir gagal');
    const { form: mulaiForm, rpc } = pasang({ form: form.janji });
    const respons = get();
    const pemeriksaan = expect(respons).rejects.toBe(galat);
    await vi.waitFor(() => expect(mulaiForm).toHaveBeenCalledOnce());
    form.tolak(galat);
    await pemeriksaan;
    expect(rpc).toHaveBeenCalledWith('pendataan_khusus_peta', { p_penanganan: ['p1'] });
  });

  it('galat kueri formulir tetap menjadi form_type null', async () => {
    pasang({ form: Promise.resolve({ data: null, error: { message: 'kueri formulir gagal' } }) });
    const res = await get();
    expect(res.status).toBe(200);
    expect((await res.json()).form_type).toBeNull();
  });

  it('tidak memulai kueri data sebelum lingkup lolos dan tetap mengutamakan galat lingkup', async () => {
    const lingkup = tahan<Hasil>();
    const { rpc, from } = pasang({ lingkup: lingkup.janji });
    const respons = get();
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledWith('lingkup_data_saya'));
    expect(rpc.mock.calls.map(([nama]) => nama)).toEqual(['lingkup_data_saya']);
    expect(from).not.toHaveBeenCalled();
    lingkup.lepas({ data: null, error: { message: 'FORBIDDEN: lingkup' } });
    const res = await respons;
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Anda tidak berhak membaca rekap ini.', kode: 'FORBIDDEN' });
    expect(from).not.toHaveBeenCalled();
  });
});
