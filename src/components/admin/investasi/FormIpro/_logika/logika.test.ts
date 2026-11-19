// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { IproAdmin } from '@/lib/data/investasi';
import { bangunPayload, nilaiDariProyek, nilaiKosong, type NilaiForm } from './nilai-form';
import { tabPertamaBergalat, validasiForm } from './validasi';
import { kekuranganTerbitKlien, labelKekurangan } from './syarat';
import { batasGambar, periksaBerkasGambar, pathMentah, rencanaUrutan } from './gambar';
import { HREF_DAFTAR_IPRO, idIproSah, sumberDariParam } from './rute';
import { iproBuatSchema, iproUbahSchema } from '@/lib/investasi/skema';
import { pathMentahIproSah } from '@/lib/storage/area';

const ptsp = (o: Partial<NilaiForm> = {}): NilaiForm => ({
  ...nilaiKosong(), judul: 'Kawasan Wisata Pesisir', ringkasan: 'Ringkasan singkat.', deskripsi: 'Deskripsi.', sektor: 'pariwisata',
  kab_kota: 'Kab. Pesawaran', ...o,
});
const foila = (o: Partial<NilaiForm> = {}): NilaiForm => ({
  ...nilaiKosong(), judul: 'Proyek FOILA', ringkasan: 'Cuplikan.', sektor: 'energi', kab_kota: 'Kota Bandar Lampung',
  sumber_url: 'https://invest.lampungprov.go.id/proyek/pltmh-way-besai', ...o,
});

describe('bangunPayload', () => {
  it('PTSP: angka dikonversi, kosong menjadi null, dan lolos skema server', () => {
    const p = bangunPayload(ptsp({ nilai_investasi: '1500000000', irr_persen: '12,5', payback_bulan: '30', lat: '-5.45', lng: '105.26', kontak_email: ' dinas@lampungprov.go.id ' }), 'ptsp');
    expect(p).toMatchObject({ nilai_investasi: 1500000000, irr_persen: 12.5, payback_bulan: 30, lat: -5.45, lng: 105.26, kontak_email: 'dinas@lampungprov.go.id', deskripsi_en: null, skema: null });
    expect(p).not.toHaveProperty('sumber_url');
    expect(p).not.toHaveProperty('slug');
    expect(iproBuatSchema.safeParse({ sumber: 'ptsp', ...p }).success).toBe(true);
    expect(iproUbahSchema.safeParse({ ...p, versi: 3 }).success).toBe(true);
  });
  it('FOILA: hanya field kartu + sumber_url (skema server strict)', () => {
    const p = bangunPayload(foila({ nilai_teks: 'IDR 53.18 trillion' }), 'foila');
    expect(Object.keys(p).sort()).toEqual(['judul', 'judul_en', 'kab_kota', 'mata_uang', 'nilai_investasi', 'nilai_teks', 'ringkasan', 'ringkasan_en', 'sektor', 'sumber_url', 'urutan']);
    expect(iproBuatSchema.safeParse({ sumber: 'foila', ...p }).success).toBe(true);
    expect(iproUbahSchema.safeParse({ ...p, versi: 1 }).success).toBe(true);
  });
  it('nilaiDariProyek membulatkan balik ke bentuk teks form', () => {
    const baris = { ...ptsp(), id: 'x', sumber: 'ptsp', status: 'draf', versi: 2, urutan: 4, nilai_investasi: 10, mata_uang: 'USD', nilai_teks: null,
      irr_persen: null, npv_nilai: -5, payback_bulan: null, luas_ha: 2.5, lat: null, lng: null, deskripsi_en: null, judul_en: null, ringkasan_en: null,
      tahap_kajian: 'fs', skema: null, status_lahan: null, lokasi_teks: null, pemilik: null, perizinan: null, dokumen_id: null,
      kontak_instansi: null, kontak_email: null, kontak_telepon: null, sumber_url: null } as unknown as IproAdmin;
    expect(nilaiDariProyek(baris)).toMatchObject({ urutan: '4', nilai_investasi: '10', mata_uang: 'USD', npv_nilai: '-5', luas_ha: '2.5', tahap_kajian: 'fs', irr_persen: '', deskripsi_en: '' });
  });
});

describe('validasiForm', () => {
  it('form PTSP lengkap valid', () => expect(validasiForm(ptsp(), 'ptsp')).toEqual({}));
  it('kolom wajib kosong ditolak dengan pesan per field', () => {
    const g = validasiForm(nilaiKosong(), 'ptsp');
    expect(Object.keys(g).sort()).toEqual(['judul', 'kab_kota', 'ringkasan', 'sektor']);
    expect(g.judul).toMatch(/wajib/);
  });
  it('rentang angka, koordinat berpasangan, email, telepon', () => {
    const g = validasiForm(ptsp({ irr_persen: '2000', payback_bulan: '0', nilai_investasi: '1.5', lat: '-5', lng: '', kontak_email: 'salah', kontak_telepon: 'abc', luas_ha: '-1' }), 'ptsp');
    expect(g).toMatchObject({ irr_persen: expect.any(String), payback_bulan: expect.any(String), nilai_investasi: expect.any(String), lng: expect.any(String),
      kontak_email: expect.any(String), kontak_telepon: expect.any(String), luas_ha: expect.any(String) });
    expect(validasiForm(ptsp({ lat: '10', lng: '105' }), 'ptsp').lat).toMatch(/Lampung/);
    expect(validasiForm(ptsp({ nilai_investasi: 'abc' }), 'ptsp').nilai_investasi).toMatch(/angka/);
  });
  it('FOILA: host harus persis invest.lampungprov.go.id', () => {
    expect(validasiForm(foila(), 'foila')).toEqual({});
    for (const url of ['https://invest.lampungprov.go.id.evil.com/x', 'http://invest.lampungprov.go.id/x', 'https://user@invest.lampungprov.go.id/x',
      'https://invest.lampungprov.go.id:8443/x', 'https://invest.lampungprov.go.id', 'https://evil.com/?https://invest.lampungprov.go.id/x', '']) {
      expect(validasiForm(foila({ sumber_url: url }), 'foila').sumber_url, url).toBeTruthy();
    }
  });
  it('field detail tidak divalidasi untuk kartu FOILA', () => {
    expect(validasiForm(foila({ kontak_email: 'salah', deskripsi: 'x'.repeat(30000) }), 'foila')).toEqual({});
  });
  it('tabPertamaBergalat memilih tab menurut urutan formulir', () => {
    expect(tabPertamaBergalat({ kab_kota: 'x', irr_persen: 'y' })).toBe('angka');
    expect(tabPertamaBergalat({ kontak_email: 'x', judul: 'y' })).toBe('informasi');
    expect(tabPertamaBergalat({})).toBeNull();
  });
});

describe('syarat terbit', () => {
  it('PTSP: butuh deskripsi dan gambar utama', () => {
    expect(kekuranganTerbitKlien(ptsp({ deskripsi: '  ' }), 'ptsp', [{ utama: false }])).toEqual(['deskripsi', 'gambar_utama']);
    expect(kekuranganTerbitKlien(ptsp(), 'ptsp', [{ utama: true }])).toEqual([]);
  });
  it('FOILA: butuh url sah dan tepat satu gambar', () => {
    expect(kekuranganTerbitKlien(foila(), 'foila', [])).toEqual(['gambar']);
    expect(kekuranganTerbitKlien(foila({ sumber_url: 'https://evil.com/x' }), 'foila', [{ utama: true }])).toEqual(['sumber_url']);
    expect(kekuranganTerbitKlien(foila(), 'foila', [{ utama: true }, { utama: false }])).toEqual(['gambar']);
  });
  it('labelKekurangan menerjemahkan kode server dan tidak membocorkan kode asing', () => {
    expect(labelKekurangan(['gambar_utama', 'aneh'])).toEqual([expect.stringMatching(/gambar utama/), 'Lengkapi data proyek.']);
  });
});

describe('gambar', () => {
  it('periksaBerkasGambar: format dan ukuran', () => {
    expect(periksaBerkasGambar({ type: 'image/png', size: 1000 })).toBeNull();
    expect(periksaBerkasGambar({ type: 'image/gif', size: 1000 })).toMatch(/Format/);
    expect(periksaBerkasGambar({ type: 'image/webp', size: 9 * 1024 * 1024 })).toMatch(/8 MB/);
    expect(periksaBerkasGambar({ type: 'image/jpeg', size: 0 })).toMatch(/kosong/);
  });
  it('batas: 12 PTSP, 1 FOILA; path mentah diterima presign', () => {
    expect(batasGambar('ptsp')).toBe(12);
    expect(batasGambar('foila')).toBe(1);
    const id = '3f2b9c1e-1111-4222-8333-444455556666', u = '9a8b7c6d-1111-4222-8333-444455556666';
    for (const mime of ['image/jpeg', 'image/png', 'image/webp']) expect(pathMentahIproSah(pathMentah(id, mime, u))).toBe(true);
  });
  it('rencanaUrutan hanya mengubah gambar yang bergeser dan menormalkan nilai ganda', () => {
    const g = (id: string, urutan: number) => ({ id, urutan });
    expect(rencanaUrutan([g('a', 0), g('b', 1), g('c', 2)], 0, 1)).toEqual([{ id: 'b', urutan: 0 }, { id: 'a', urutan: 1 }]);
    expect(rencanaUrutan([g('a', 0), g('b', 0), g('c', 0)], 2, 1)).toEqual([{ id: 'c', urutan: 1 }, { id: 'b', urutan: 2 }]);
    expect(rencanaUrutan([g('a', 0)], 0, 1)).toEqual([]);
    expect(rencanaUrutan([g('a', 0), g('b', 1)], 0, 0)).toEqual([]);
  });
});

describe('rute', () => {
  it('padanan admin dan petugas, id UUID, dan param sumber', () => {
    expect(HREF_DAFTAR_IPRO).toEqual({ admin: '/admin/ipro', petugas: '/petugas/investasi/ipro' });
    expect(idIproSah('3f2b9c1e-1111-4222-8333-444455556666')).toBe(true);
    expect(idIproSah('baru')).toBe(false);
    expect(sumberDariParam('foila')).toBe('foila');
    for (const v of ['ptsp', undefined, 'x', ['foila']]) expect(sumberDariParam(v)).toBe('ptsp');
  });
});
