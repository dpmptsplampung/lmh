import { describe, expect, it } from 'vitest';
import { gambarSchema, gambarUbahSchema, iproBuatSchema, iproUbahSchema, statusAksiSchema } from './skema';

const ptsp = { sumber: 'ptsp', judul: ' Energi Lampung ', ringkasan: 'Ringkasan proyek', sektor: 'energi', kab_kota: 'Kota Bandar Lampung' };
describe('isian IPRO ketat', () => {
  it('menerima data minimal dan menormalkan teks', () => {
    expect(iproBuatSchema.parse(ptsp).judul).toBe('Energi Lampung');
    expect(iproBuatSchema.safeParse({ ...ptsp, nilai_investasi: 0, mata_uang: 'USD', npv_nilai: -1000 }).success).toBe(true);
  });
  it.each([
    { status: 'terbit' }, { dibuat_oleh: 'x' }, { sektor: 'tambang' }, { kab_kota: 'Jakarta' },
    { mata_uang: 'EUR' }, { nilai_investasi: -1 }, { nilai_investasi: 1.5 }, { lat: -5 },
    { lat: -5, lng: 100 }, { ringkasan: 'a\u0000b' }, { ringkasan: 'a\tb' }, { judul: '\tEnergi' },
    { payback_bulan: 601 }, { sumber_url: 'https://invest.lampungprov.go.id/x' },
  ])('menolak isian %j', perubahan => expect(iproBuatSchema.safeParse({ ...ptsp, ...perubahan }).success).toBe(false));
  it('menerima koordinat berpasangan dan baris baru', () => {
    expect(iproBuatSchema.safeParse({ ...ptsp, lat: -5, lng: 105, deskripsi: 'Baris\nbaru' }).success).toBe(true);
  });
  it('FOILA hanya cuplikan dengan tautan sumber resmi', () => {
    const foila = { ...ptsp, sumber: 'foila', sumber_url: 'https://invest.lampungprov.go.id/proyek/energi', nilai_teks: 'IDR 53.18 trillion' };
    expect(iproBuatSchema.safeParse(foila).success).toBe(true);
    expect(iproBuatSchema.safeParse({ ...foila, deskripsi: 'Detail' }).success).toBe(false);
    expect(iproBuatSchema.safeParse({ ...foila, sumber_url: 'https://invest.lampungprov.go.id:443/x' }).success).toBe(false);
    expect(iproBuatSchema.safeParse({ ...foila, sumber_url: 'https://invest.lampungprov.go.id/' }).success).toBe(false);
  });
  it('mutasi memerlukan versi dan menolak kolom internal', () => {
    expect(iproUbahSchema.safeParse({ judul: 'Proyek baru' }).success).toBe(false);
    expect(iproUbahSchema.safeParse({ versi: 1 }).success).toBe(false);
    expect(iproUbahSchema.safeParse({ versi: 1, judul: 'Proyek baru' }).success).toBe(true);
    expect(iproUbahSchema.safeParse({ versi: 1, status: 'terbit' }).success).toBe(false);
    expect(statusAksiSchema.safeParse({ versi: 1, aksi: 'hapus' }).success).toBe(false);
    expect(gambarSchema.safeParse({ kunci_mentah: 'x', alt: 'ab' }).success).toBe(false);
    expect(gambarUbahSchema.safeParse({}).success).toBe(false);
  });
});
