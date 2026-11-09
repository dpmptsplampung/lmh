// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/storage/r2', () => ({ r2Tersedia: () => true, bucketTerpisah: () => true,
  presignGet: vi.fn(async () => 'https://private.example/foto') }));
import { createClient } from '@/lib/supabase/server';
import { GET as daftar, POST as daftarBaru } from '@/app/api/umkm-pemilik/route';
import { POST as draf } from '@/app/api/umkm-pemilik/[id]/draf/route';
import { GET as foto } from '@/app/api/umkm-pemilik/[id]/foto/[fotoId]/route';
import { POST as putusan } from '@/app/api/admin/umkm-tugas/klaim/[id]/putusan/route';
import { POST as cabut } from '@/app/api/admin/umkm-tugas/klaim/[id]/cabut/route';
import { GET as tahap } from '@/app/api/umkm-pemilik/tahap/route';
const id = '660e8400-e29b-41d4-a716-446655440001';
const fotoId = '660e8400-e29b-41d4-a716-446655440002';
const data = { nama: 'Kopi', deskripsi: '', jenis: 'Produk', kategori: 'Pangan', kabupaten_kota: 'Lampung' };
let rpc: ReturnType<typeof vi.fn>;
let masuk = true;
const req = (body?: unknown) => new Request('https://lmh.example/api/test', body === undefined ? {} : {
  method: 'POST', body: JSON.stringify(body),
});
const context = () => ({ params: Promise.resolve({ id }) });
beforeEach(() => {
  masuk = true; rpc = vi.fn().mockResolvedValue({ data: { id, versi: 1 }, error: null });
  vi.mocked(createClient).mockResolvedValue({ rpc, auth: {
    getUser: async () => ({ data: { user: masuk ? { id } : null }, error: null }),
  } } as unknown as Awaited<ReturnType<typeof createClient>>);
});
it('route pemilik memerlukan login, no-store dan 503 tenang bila RPC belum tersedia', async () => {
  masuk = false;
  expect((await daftar(req())).status).toBe(401);
  masuk = true;
  rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'rincian privat' } });
  const response = await daftar(req());
  expect(response.status).toBe(503);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(JSON.stringify(await response.json())).not.toContain('rincian privat');
});
it('daftar/draf menolak aktor dan sumber dari klien, lalu meneruskan field versi yang sah', async () => {
  expect((await daftarBaru(req({ data: { ...data, sumber: 'kurasi' }, operasi_id: id }))).status).toBe(400);
  expect((await daftarBaru(req({ data, operasi_id: id, aktor_uid: id }))).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
  expect((await draf(req({ data, expected_version: 2, operasi_id: id }), context())).status).toBe(200);
  expect(rpc).toHaveBeenCalledWith('umkm_simpan_draf', {
    p_profil_id: id, p_data: data, p_expected_version: 2, p_operasi_id: id,
  });
});
it('putusan klaim menolak alasan kosong untuk penolakan dan memakai JWT pengguna', async () => {
  expect((await putusan(req({ keputusan: 'ditolak', expected_version: 1, operasi_id: id }), context()))
    .status).toBe(400);
  expect((await putusan(req({ keputusan: 'disetujui', expected_version: 1, operasi_id: id }), context()))
    .status).toBe(200);
  expect(rpc).toHaveBeenCalledWith('umkm_putuskan_klaim', {
    p_id: id, p_keputusan: 'disetujui', p_expected_version: 1, p_operasi_id: id, p_alasan: null,
  });
});
it('foto hanya berasal detail privat profil yang diizinkan; respons 307 tanpa cache', async () => {
  const ctx = { params: Promise.resolve({ id, fotoId }) };
  rpc.mockResolvedValue({ data: { foto: [] }, error: null });
  expect((await foto(req(), ctx)).status).toBe(404);
  rpc.mockResolvedValue({ data: { foto: [{ id: fotoId, asal: 'unggahan',
    r2_key: `umkm-draf/${id}/${fotoId}.jpg` }] }, error: null });
  const response = await foto(req(), ctx);
  expect(response.status).toBe(307);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(response.headers.get('Location')).toBe('https://private.example/foto');
  expect(rpc).toHaveBeenCalledWith('umkm_detail_usaha', { p_profil_id: id });
});
it('cabut kepemilikan mewajibkan alasan dan meneruskan versi, operasi dan alasan', async () => {
  expect((await cabut(req({ expected_version: 1, operasi_id: id }), context())).status).toBe(400);
  expect((await cabut(req({ expected_version: 1, operasi_id: id, alasan: ' ' }), context())).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
  const response = await cabut(req({ expected_version: 3, operasi_id: id, alasan: 'Bukan pengelola' }), context());
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(rpc).toHaveBeenCalledWith('umkm_cabut_kepemilikan', {
    p_id: id, p_expected_version: 3, p_operasi_id: id, p_alasan: 'Bukan pengelola',
  });
});
it('tahap C boleh tanpa login dan 503 tenang bila belum aktif atau RPC belum ada', async () => {
  masuk = false;
  rpc.mockResolvedValue({ data: { aktif: true }, error: null });
  let response = await tahap();
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual({ aktif: true });
  expect(rpc).toHaveBeenCalledWith('umkm_tahap_c', {});
  rpc.mockResolvedValue({ data: { aktif: false }, error: null });
  expect((await tahap()).status).toBe(503);
  rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'rincian privat' } });
  response = await tahap();
  expect(response.status).toBe(503);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(JSON.stringify(await response.json())).not.toContain('rincian privat');
});
