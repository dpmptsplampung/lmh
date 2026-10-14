import { describe, it, expect, vi, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { muatNamaFoPerTiket, tambahNamaFo } from './foTiket';

type Hasil = { data: unknown; error: unknown };

function klien(jawab: (ids: string[]) => Hasil | Promise<Hasil>) {
  const panggilan: { tabel: string; select: string; ids: string[] }[] = [];
  const supabase = {
    from(tabel: string) {
      let select = '';
      const b: Record<string, unknown> = {};
      b.select = (s: string) => {
        select = s;
        return b;
      };
      b.in = (_kolom: string, ids: string[]) => {
        panggilan.push({ tabel, select, ids });
        return Promise.resolve(jawab(ids));
      };
      return b;
    },
  };
  return { supabase: supabase as unknown as SupabaseClient, panggilan };
}

const tahapFo = (nama: string, ke = 1) => [{ tahap_ke: ke, peran_tahap: 'fo', penangan_id: `id-${nama}`, petugas: { nama } }];

describe('muatNamaFoPerTiket', () => {
  afterEach(() => vi.restoreAllMocks());

  it('mengambil tahap FO lewat tiket_antrean.kunjungan; FO terakhir yang dipakai; tiket tanpa tahap FO tak masuk peta', async () => {
    const { supabase, panggilan } = klien(() => ({
      data: [
        { id: 't1', kunjungan: { tahap_fo: [...tahapFo('Ani', 1), ...tahapFo('Bayu', 3)] } },
        { id: 't2', kunjungan: [{ tahap_fo: tahapFo('Citra') }] },
        { id: 't3', kunjungan: { tahap_fo: [] } },
        { id: 't4', kunjungan: null },
      ],
      error: null,
    }));
    const peta = await muatNamaFoPerTiket(supabase, ['t1', 't2', 't3', 't4', 't1', null, undefined]);
    expect(Object.fromEntries(peta)).toEqual({ t1: 'Bayu', t2: 'Citra' });
    expect(panggilan).toHaveLength(1);
    expect(panggilan[0].tabel).toBe('tiket_antrean');
    expect(panggilan[0].select).toContain('penanganan!kunjungan_id');
    expect(panggilan[0].ids).toEqual(['t1', 't2', 't3', 't4']); // unik, tanpa null
  });

  it('memotong id per 100 agar URL tidak kepanjangan', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `t${i}`);
    const { supabase, panggilan } = klien((p) => ({ data: p.map((id) => ({ id, kunjungan: { tahap_fo: tahapFo('Ani') } })), error: null }));
    const peta = await muatNamaFoPerTiket(supabase, ids);
    expect(panggilan.map((p) => p.ids.length)).toEqual([100, 100, 50]);
    expect(peta.size).toBe(250);
  });

  it('tanpa id: tidak ada kueri', async () => {
    const { supabase, panggilan } = klien(() => ({ data: [], error: null }));
    expect((await muatNamaFoPerTiket(supabase, [])).size).toBe(0);
    expect(panggilan).toHaveLength(0);
  });

  it('galat DB atau pengecualian tidak dilempar (rekap tetap jalan, nama kosong)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const a = klien(() => ({ data: null, error: { message: 'rls' } }));
    expect((await muatNamaFoPerTiket(a.supabase, ['t1'])).size).toBe(0);
    const b = klien(() => {
      throw new Error('jaringan');
    });
    expect((await muatNamaFoPerTiket(b.supabase, ['t1'])).size).toBe(0);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('tambahNamaFo', () => {
  it('menambah fo_nama (null bila tak diketahui) tanpa mengubah baris lain', async () => {
    const { supabase } = klien(() => ({ data: [{ id: 't1', kunjungan: { tahap_fo: tahapFo('Ani') } }], error: null }));
    const hasil = await tambahNamaFo(supabase, [
      { tiket_id: 't1', nomor_display: 'A-1' },
      { tiket_id: 't-lama', nomor_display: 'A-0' },
      { tiket_id: null, nomor_display: 'A-x' },
    ]);
    expect(hasil).toEqual([
      { tiket_id: 't1', nomor_display: 'A-1', fo_nama: 'Ani' },
      { tiket_id: 't-lama', nomor_display: 'A-0', fo_nama: null },
      { tiket_id: null, nomor_display: 'A-x', fo_nama: null },
    ]);
  });
});
