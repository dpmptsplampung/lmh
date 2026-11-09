// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
import { createClient } from '@/lib/supabase/server';
import { GET as perusahaan } from '@/app/api/umkm-katalog/perusahaan/route';
import { POST as ajukan } from '@/app/api/umkm-katalog/permintaan/route';
import { GET as nomor } from '@/app/api/umkm-katalog/permintaan/[id]/nomor/route';
import { POST as tautkan } from '@/app/api/umkm-katalog/tautkan/route';
const id = '660e8400-e29b-41d4-a716-446655440001';
let rpc: ReturnType<typeof vi.fn>;
let masuk = true;
const request = (body: unknown) => new Request('https://lmh.example/api/test', {
  method: 'POST', body: JSON.stringify(body),
});
beforeEach(() => {
  masuk = true;
  rpc = vi.fn().mockResolvedValue({ data: { aktif: true }, error: null });
  vi.mocked(createClient).mockResolvedValue({ rpc, auth: {
    getUser: async () => ({ data: { user: masuk ? { id } : null }, error: null }),
  } } as unknown as Awaited<ReturnType<typeof createClient>>);
});
it('publik mengetahui modul aktif tanpa akun; missing RPC tetap 503 tanpa rincian privat', async () => {
  masuk = false;
  let result = await perusahaan();
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({ data: { masuk: false, perusahaan: null } });
  rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'isi privat' } });
  result = await perusahaan();
  expect(result.status).toBe(503);
  expect(JSON.stringify(await result.json())).not.toContain('isi privat');
});
it('batch menolak UID palsu dan potongan lebih dari 50, tanpa RPC', async () => {
  for (const body of [
    { kebutuhan_id: id, profil_ids: [id], operasi_id: id, pemohon_uid: id },
    { kebutuhan_id: id, profil_ids: Array(51).fill(id), operasi_id: id },
  ]) expect((await ajukan(request(body))).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});
it('baca nomor memakai JWT dan no-store; guard ditolak tanpa echo galat DB', async () => {
  rpc.mockResolvedValue({ data: null, error: { code: '40001', message: 'NOMOR_TIDAK_TERSEDIA' } });
  const result = await nomor(new Request('https://lmh.example/api/test'), { params: Promise.resolve({ id }) });
  expect(result.status).toBe(409);
  expect(result.headers.get('Cache-Control')).toBe('private, no-store');
  expect(rpc).toHaveBeenCalledWith('umkm_baca_nomor', { p_permintaan_id: id });
});
it('kode salah disampaikan sebagai 409 sesudah RPC menyimpan laju', async () => {
  rpc.mockResolvedValue({ data: { tertaut: false }, error: null });
  const result = await tautkan(request({ kode: 'SALAH' }));
  expect(result.status).toBe(409);
  expect(await result.json()).toMatchObject({ error: { code: 'KODE_TIDAK_VALID' } });
});
