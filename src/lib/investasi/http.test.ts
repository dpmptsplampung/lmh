// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { bacaJson, galat, galatRpc, kodeRpc } from './http';
describe('kontrak HTTP investasi', () => {
  it.each([['INPUT_TIDAK_VALID', 400], ['LOGIN_DIPERLUKAN', 401], ['DILARANG', 403], ['TIDAK_DITEMUKAN', 404],
    ['KONFLIK_OPERASI', 409], ['SLUG_TERKUNCI', 409], ['SYARAT_TERBIT', 409], ['TERLALU_BANYAK', 429], ['GAGAL_INTERNAL', 500]])('%s menjadi %i', async (kode, status) => {
    const r = galat(kode, 'request'); expect(r.status).toBe(status);
    expect(r.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await r.json()).toMatchObject({ error: { code: kode }, request_id: 'request' });
    if (status === 429) expect(r.headers.get('Retry-After')).toBe('60');
  });
  it('menyamarkan pesan database dan mempertahankan galat domain', () => {
    expect(kodeRpc({ code: '40001', message: 'KONFLIK_OPERASI' })).toBe('KONFLIK_OPERASI');
    expect(kodeRpc({ code: '23505', message: 'private email' })).toBe('KONFLIK_STATUS');
    expect(kodeRpc({ code: '23514' })).toBe('INPUT_TIDAK_VALID');
    expect(kodeRpc({ message: 'email@private.test' })).toBe('GAGAL_INTERNAL');
  });
  it.each([['PGRST301', 'LOGIN_DIPERLUKAN'], ['PGRST302', 'LOGIN_DIPERLUKAN'],
    ['55P03', 'KONFLIK_VERSI'], ['23503', 'KONFLIK_STATUS'], ['23514', 'INPUT_TIDAK_VALID'],
    ['22003', 'INPUT_TIDAK_VALID'], ['XX000', 'GAGAL_INTERNAL']])('SQL %s menjadi %s', (code, hasil) => {
    expect(kodeRpc({ code, message: 'pesan internal' })).toBe(hasil);
  });
  it('hanya meneruskan kode domain yang dikenal', async () => {
    expect(kodeRpc({ code: 'XX000', message: 'KONFLIK_RAHASIA' })).toBe('GAGAL_INTERNAL');
    expect(await galat('email@private.test', 'r').json()).toMatchObject({ error: { code: 'GAGAL_INTERNAL' } });
  });
  it('kekurangan dari RPC hanya menyertakan nama field publik', async () => {
    const response = galatRpc({ code: '23514', message: 'SYARAT_TERBIT',
      details: '["gambar_utama","email@private.test","deskripsi"]' }, 'r');
    expect(await response.json()).toMatchObject({ error: { code: 'SYARAT_TERBIT', kekurangan: ['deskripsi', 'gambar_utama'] } });
    for (const details of ['email@private.test', '{"internal":"email@private.test"}']) {
      const response = galatRpc({ message: 'SYARAT_TERBIT', details }, 'r');
      expect(await response.text()).not.toContain('email@private.test');
    }
  });
  const req = (body: string, headers?: Record<string, string>) => new Request('https://local.test', { method: 'POST', body, headers });
  it('menghitung byte stream dan header, termasuk Unicode', async () => {
    expect(await bacaJson(req(JSON.stringify('a'.repeat(16382))))).toHaveLength(16382);
    await expect(bacaJson(req(JSON.stringify('a'.repeat(16383))))).rejects.toThrow('INPUT_TIDAK_VALID');
    await expect(bacaJson(req(JSON.stringify('é'.repeat(9000))))).rejects.toThrow('INPUT_TIDAK_VALID');
    await expect(bacaJson(req('{}', { 'content-length': '16385' }))).rejects.toThrow('INPUT_TIDAK_VALID');
    await expect(bacaJson(req('invalid'))).rejects.toThrow('INPUT_TIDAK_VALID');
  });
});
