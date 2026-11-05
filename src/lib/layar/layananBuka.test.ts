import { describe, it, expect, vi } from 'vitest';
import {
  petaStatusBuka,
  keteranganLibur,
  tataKisi,
  ambilStatusBuka,
  type PetaStatusBuka,
} from './layananBuka';

describe('petaStatusBuka', () => {
  it('mengubah baris RPC menjadi peta per layanan', () => {
    const peta = petaStatusBuka([
      { layanan_id: 'a', buka_sekarang: true, libur_keterangan: null },
      { layanan_id: 'b', buka_sekarang: false, libur_keterangan: 'Idul Fitri' },
    ]);
    expect(peta?.get('a')).toEqual({ buka: true, libur: null, hari: [] });
    expect(peta?.get('b')).toEqual({ buka: false, libur: 'Idul Fitri', hari: [] });
  });

  it('bukan larik (RPC belum ada / jawaban tak terduga) = null, bukan tebakan', () => {
    expect(petaStatusBuka(null)).toBeNull();
    expect(petaStatusBuka(true)).toBeNull();
    expect(petaStatusBuka({})).toBeNull();
  });

  it('melewati baris tanpa id atau buka_sekarang bukan boolean', () => {
    const peta = petaStatusBuka([
      { layanan_id: '', buka_sekarang: true },
      { layanan_id: 'x', buka_sekarang: 'ya' },
      { layanan_id: 'ok', buka_sekarang: false },
    ]);
    expect([...(peta?.keys() ?? [])]).toEqual(['ok']);
  });
});

describe('keteranganLibur', () => {
  it('mengembalikan keterangan libur pertama bila ada', () => {
    const peta: PetaStatusBuka = new Map([
      ['a', { buka: false, libur: null, hari: [] }],
      ['b', { buka: false, libur: 'Idul Fitri', hari: [] }],
    ]);
    expect(keteranganLibur(peta)).toBe('Idul Fitri');
  });
  it('null bila tidak libur atau status tak diketahui', () => {
    expect(keteranganLibur(new Map([['a', { buka: false, libur: null, hari: [] }]]))).toBeNull();
    expect(keteranganLibur(null)).toBeNull();
  });
});

describe('tataKisi: satu layar tanpa scroll', () => {
  it.each([
    [1, 1, 1],
    [2, 2, 1],
    [4, 2, 2],
    [6, 3, 2],
    [12, 4, 3],
    [20, 5, 4],
  ])('%i layanan di layar 16:9 = %i kolom x %i baris', (n, kolom, barisEks) => {
    expect(tataKisi(n)).toEqual({ kolom, baris: barisEks });
  });

  it('selalu memuat semua kartu, untuk 0..40 layanan di rasio mendatar maupun tegak', () => {
    for (const rasio of [16 / 9, 9 / 16, 4 / 3]) {
      for (let n = 0; n <= 40; n++) {
        const { kolom, baris: b } = tataKisi(n, rasio);
        expect(kolom).toBeGreaterThanOrEqual(1);
        expect(b).toBeGreaterThanOrEqual(1);
        expect(kolom * b).toBeGreaterThanOrEqual(n);
      }
    }
  });

  it('layar tegak (potret) memberi lebih banyak baris daripada kolom', () => {
    const { kolom, baris: b } = tataKisi(6, 9 / 16);
    expect(b).toBeGreaterThan(kolom);
  });

  it('rasio tak valid memakai bawaan 16:9', () => {
    expect(tataKisi(6, Number.NaN)).toEqual(tataKisi(6));
    expect(tataKisi(6, 0)).toEqual(tataKisi(6));
  });
});

describe('ambilStatusBuka', () => {
  it('memanggil RPC layanan_status_hari_ini dan memetakan hasilnya', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ layanan_id: 'a', buka_sekarang: true, libur_keterangan: null }],
      error: null,
    });
    const peta = await ambilStatusBuka({ rpc } as never);
    expect(rpc).toHaveBeenCalledWith('layanan_status_hari_ini');
    expect(peta?.get('a')?.buka).toBe(true);
  });

  it('galat RPC atau pengecualian = null (tidak menebak jadwal)', async () => {
    expect(await ambilStatusBuka({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'x' } }) } as never)).toBeNull();
    expect(await ambilStatusBuka({ rpc: vi.fn().mockRejectedValue(new Error('jaringan')) } as never)).toBeNull();
  });
});
