// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { muatLayananEkspor } from './exportServer';

function klien(semua: boolean, layananId: string | null, galat = false) {
  const eq: unknown[][] = [];
  const rpc = vi.fn(async () => ({ data: [{ semua, layanan_id: layananId }], error: null }));
  const from = vi.fn((table: string) => {
    let offset = 0;
    const b: unknown = new Proxy({}, { get(_t, k: string) {
      if (k === 'then') return (r: (v: unknown) => void) => r({
        data: table === 'layanan' && offset === 0 ? [{ id: 'a', nama: 'A', form_pendataan: null }] : [],
        error: galat ? { message: 'timeout' } : null,
      });
      return (...args: unknown[]) => { if (k === 'eq') eq.push(args); if (k === 'range') offset = Number(args[0]); return b; };
    } });
    return b;
  });
  return { client: { rpc, from } as unknown as SupabaseClient, eq, rpc, from };
}
describe('katalog sheet mengikuti lingkup RPC rekap G2', () => {
  it('petugas dibatasi id layanan RPC, termasuk layanan kosong periode ini', async () => {
    const k = klien(false, 'a');
    expect(await muatLayananEkspor(k.client, false)).toEqual([{ id: 'a', nama: 'A', form_pendataan: null, fields: [] }]);
    expect(k.eq).toContainEqual(['id', 'a']);
    expect(k.rpc).toHaveBeenCalledWith('lingkup_layanan_saya');
  });
  it('FO/admin tanpa filter kepemilikan; galat tidak ditelan', async () => {
    const k = klien(true, null);
    expect(await muatLayananEkspor(k.client, false)).toHaveLength(1);
    expect(k.eq).not.toContainEqual(['id', null]);
    await expect(muatLayananEkspor(klien(true, null, true).client, false)).rejects.toMatchObject({ message: 'timeout' });
  });
  it('petugas tanpa layanan tidak mendapat sheet layanan lain', async () => {
    const k = klien(false, null);
    expect(await muatLayananEkspor(k.client, false)).toEqual([]);
    expect(k.from).not.toHaveBeenCalled();
  });
});
