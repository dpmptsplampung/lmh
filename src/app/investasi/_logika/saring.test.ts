import { describe, expect, it } from 'vitest';
import type { KartuPublik } from '@/lib/data/publik-server';
import { adaSaringan, pilihanDari, ringkasPeta, SARINGAN_KOSONG, susunHash, terapkanSaringan, uraiHash } from './saring';

const k = (id: string, sektor: string, kab_kota: string, tahap_kajian: string | null = null) =>
  ({ id, sektor, kab_kota, tahap_kajian }) as KartuPublik;
const daftar = [k('1', 'energi', 'Kab. Pesawaran', 'fs'), k('2', 'pariwisata', 'Kab. Pesawaran'), k('3', 'energi', 'Kab. Lampung Selatan', 'ipro')];

describe('hash saringan', () => {
  it('urai dan susun bolak-balik', () => {
    const s = { sektor: 'energi', kab: 'Kab. Lampung Selatan', tahap: 'fs' };
    expect(uraiHash(susunHash(s))).toEqual(s);
    expect(susunHash(SARINGAN_KOSONG)).toBe('');
  });
  it('nilai tak dikenal dibuang; hash tanpa pasangan (mis. #peta-potensi) = tanpa saringan', () => {
    expect(uraiHash('#sektor=bukan-sektor&kab=Atlantis&tahap=zzz')).toEqual(SARINGAN_KOSONG);
    expect(uraiHash('#peta-potensi')).toEqual(SARINGAN_KOSONG);
    expect(uraiHash('')).toEqual(SARINGAN_KOSONG);
    expect(uraiHash('#sektor=energi&x=1').sektor).toBe('energi');
  });
  it('adaSaringan', () => {
    expect(adaSaringan(SARINGAN_KOSONG)).toBe(false);
    expect(adaSaringan({ ...SARINGAN_KOSONG, tahap: 'fs' })).toBe(true);
  });
});

describe('terapkanSaringan dan pilihanDari', () => {
  it('menyaring dengan AND', () => {
    expect(terapkanSaringan(daftar, { sektor: 'energi', kab: '', tahap: '' }).map(x => x.id)).toEqual(['1', '3']);
    expect(terapkanSaringan(daftar, { sektor: 'energi', kab: 'Kab. Pesawaran', tahap: '' }).map(x => x.id)).toEqual(['1']);
    expect(terapkanSaringan(daftar, { sektor: '', kab: '', tahap: 'ipro' }).map(x => x.id)).toEqual(['3']);
    expect(terapkanSaringan(daftar, SARINGAN_KOSONG)).toHaveLength(3);
  });
  it('pilihan hanya yang ada di data, berlabel Indonesia', () => {
    const p = pilihanDari(daftar);
    expect(p.sektor).toEqual([{ nilai: 'pariwisata', label: 'Pariwisata' }, { nilai: 'energi', label: 'Energi' }]);
    expect(p.tahap.map(t => t.nilai)).toEqual(['fs', 'ipro']);
    expect(p.kab.map(x => x.nilai).sort()).toEqual(['Kab. Lampung Selatan', 'Kab. Pesawaran']);
  });
});

describe('ringkasPeta', () => {
  it('menjumlahkan per sektor dan kabupaten/kota; sektor tanpa proyek tetap ada dengan jumlah 0', () => {
    const peta = ringkasPeta([
      { sektor: 'energi', kab_kota: 'Kab. Pesawaran', jumlah: 2 }, { sektor: 'energi', kab_kota: 'Kab. Lampung Selatan', jumlah: 1 },
      { sektor: 'pariwisata', kab_kota: 'Kab. Pesawaran', jumlah: 1 },
    ]);
    expect(peta.sektor).toHaveLength(9);
    expect(peta.sektor.find(s => s.nilai === 'energi')).toMatchObject({ jumlah: 3, kab: ['Kab. Lampung Selatan', 'Kab. Pesawaran'] });
    expect(peta.sektor.find(s => s.nilai === 'pertanian')).toMatchObject({ jumlah: 0, kab: [] });
    expect(peta.kab).toContainEqual({ nilai: 'Kab. Pesawaran', jumlah: 3 });
  });
});
