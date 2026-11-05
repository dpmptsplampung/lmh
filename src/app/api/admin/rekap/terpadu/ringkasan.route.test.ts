// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { createClient } from '@/lib/supabase/server';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
type Hasil = { data: unknown; error: unknown };
const lingkup = { petugas_id: 'fo1', role: 'front_office', koordinator: false, layanan_id: null };
function pasang(ringkasan: Hasil, role = 'front_office') {
  const rpc = vi.fn(async (nama: string) => {
    if (nama === 'lingkup_data_saya') return { data: { ...lingkup, role }, error: null };
    if (nama === 'rekap_ringkasan_dilayani') return ringkasan;
    return { data: { rows: [], total: 0, ringkasan: {} }, error: null };
  });
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) }, rpc,
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  return rpc;
}
const get = (qs: string) => GET(new NextRequest(`http://localhost/api/admin/rekap/terpadu?dari=2026-11-01&sampai=2026-11-03&${qs}`));

describe('ringkasan dilayani pada API rekap', () => {
  beforeEach(() => vi.clearAllMocks());
  it('data menambah tiga angka dengan filter yang sama, tidak memakai jumlah halaman', async () => {
    const rpc = pasang({ data: { saya: 45, total: 120, persen: 37.5 }, error: null }, 'admin');
    const body = await (await get('bagian=data&tanpa_form=1&page_size=1')).json();
    expect(body.dilayani).toEqual({ saya: 45, total: 120, persen: 37.5 });
    expect(rpc).toHaveBeenCalledWith('rekap_ringkasan_dilayani', {
      p_dari: '2026-11-01', p_sampai: '2026-11-03', p_unit: null, p_layanan_id: null, p_tanpa_form: true,
    });
  });
  it('harian dan kinerja mengabaikan tanpa_form agar penyebut mengikuti tabel agregat', async () => {
    const rpc = pasang({ data: { saya: 1, total: 3, persen: 33.33 }, error: null });
    for (const bagian of ['harian', 'kinerja']) {
      const body = await (await get(`bagian=${bagian}&unit=fo&tanpa_form=1`)).json();
      expect(body.dilayani).toEqual({ saya: 1, total: 3, persen: 33.33 });
    }
    expect(rpc).toHaveBeenCalledWith('rekap_ringkasan_dilayani', {
      p_dari: '2026-11-01', p_sampai: '2026-11-03', p_unit: 'fo', p_layanan_id: null, p_tanpa_form: false,
    });
  });
  it.each(['PGRST202', 'PGRST204', 'PGRST205', '42883', '42P01', '42703'])('objek belum ada (%s): rekap lama tetap berjalan tanpa angka pengganti', async code => {
    pasang({ data: null, error: { code, message: 'not found' } });
    const res = await get('bagian=harian');
    expect(res.status).toBe(200);
    expect((await res.json()).dilayani).toBeNull();
  });
  it('galat selain objek hilang menggagalkan permintaan, bukan nol atau null', async () => {
    pasang({ data: null, error: { code: 'XX000', message: 'DB gagal' } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try { expect((await get('bagian=data')).status).toBe(500); } finally { spy.mockRestore(); }
  });
  it('sesi yang digantikan ditolak 401 dan peran terlarang ditolak 403', async () => {
    pasang({ data: null, error: { code: '42501', message: 'SESI_TIDAK_SAH: sesi digantikan' } });
    expect((await get('bagian=harian')).status).toBe(401);
    pasang({ data: null, error: { code: '42501', message: 'FORBIDDEN: hanya staf aktif' } });
    expect((await get('bagian=harian')).status).toBe(403);
  });
  it.each([null, {}, { saya: null, total: 0, persen: 0 }, { saya: -1, total: 2, persen: 0 }, { saya: 5, total: 2, persen: 250 }])('respons agregat rusak tidak disembunyikan sebagai belum migrasi: %j', async data => {
    pasang({ data, error: null });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try { expect((await get('bagian=harian')).status).toBe(500); } finally { spy.mockRestore(); }
  });
});
