import { describe, expect, it } from 'vitest';
import { profilSchema } from './schemas';

const dasar = {
  nama: 'Kopi Ibu', deskripsi: '', jenis: 'Produk', kategori: 'Makanan Olahan',
  kabupaten_kota: 'Kota Bandar Lampung', sumber: 'loket' as const,
};
const fotoTautan = (n: number) => ({ asal: 'eksternal' as const, url: `https://contoh.id/foto-${n}.jpg` });
const produk = (n: number) => ({ nama: `Produk ${n}` });

describe('profilSchema produk dan foto utama', () => {
  it('menerima profil lengkap dengan produk dan foto utama', () => {
    const r = profilSchema.safeParse({
      ...dasar, kecamatan: 'Kedaton', nama_pemilik: 'Siti', bentuk_usaha: 'CV', tahun_mulai: 2015,
      omzet_rentang: '50_300jt', tenaga_kerja_rentang: '5-19',
      foto: [fotoTautan(1), { ...fotoTautan(2), utama: true }],
      produk: [{
        nama: 'Keripik', keterangan: 'Renyah', kapasitas_jumlah: 1500, kapasitas_satuan: 'kg',
        kapasitas_periode: 'bulan', foto: fotoTautan(3),
      }],
    });
    expect(r.success).toBe(true);
  });

  it('menolak kategori yang bukan milik jenisnya', () => {
    const r = profilSchema.safeParse({ ...dasar, jenis: 'Jasa', kategori: 'Makanan Olahan' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some(i => i.path.join('.') === 'kategori')).toBe(true);
  });

  it('menolak kabupaten di luar 15 nama', () => {
    expect(profilSchema.safeParse({ ...dasar, kabupaten_kota: 'Lampung' }).success).toBe(false);
  });

  it('menolak tahun mulai di depan tahun berjalan', () => {
    expect(profilSchema.safeParse({ ...dasar, tahun_mulai: 2999 }).success).toBe(false);
  });

  it('kapasitas semua atau tidak sama sekali', () => {
    const coba = (p: object) => profilSchema.safeParse({ ...dasar, produk: [{ nama: 'A', ...p }] }).success;
    expect(coba({ kapasitas_jumlah: 10 })).toBe(false);
    expect(coba({})).toBe(true);
    expect(coba({ kapasitas_jumlah: null, kapasitas_satuan: null, kapasitas_periode: null })).toBe(true);
    expect(coba({ kapasitas_jumlah: 10, kapasitas_satuan: 'kg', kapasitas_periode: 'hari' })).toBe(true);
    expect(coba({ kapasitas_jumlah: 0, kapasitas_satuan: 'kg', kapasitas_periode: 'hari' })).toBe(false);
  });

  it('paling banyak satu foto utama', () => {
    const dua = [{ ...fotoTautan(1), utama: true }, { ...fotoTautan(2), utama: true }];
    expect(profilSchema.safeParse({ ...dasar, foto: dua }).success).toBe(false);
    expect(profilSchema.safeParse({ ...dasar, foto: [dua[0], fotoTautan(2)] }).success).toBe(true);
  });

  it('foto produk tidak boleh punya utama', () => {
    const r = profilSchema.safeParse({
      ...dasar, produk: [{ nama: 'A', foto: { ...fotoTautan(1), utama: true } }],
    });
    expect(r.success).toBe(false);
  });

  it('maksimal 20 produk', () => {
    const buat = (n: number) => Array.from({ length: n }, (_, i) => produk(i));
    expect(profilSchema.safeParse({ ...dasar, produk: buat(20) }).success).toBe(true);
    expect(profilSchema.safeParse({ ...dasar, produk: buat(21) }).success).toBe(false);
  });
});
