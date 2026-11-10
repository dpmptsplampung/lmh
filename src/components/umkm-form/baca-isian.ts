// Mengubah isian tiga bagian formulir (usaha, lokasi, kontak) menjadi objek siap zod.
import type {
  BentukUsaha, OmzetRentang, TenagaKerjaRentang,
} from '@/lib/umkm-katalog/taksonomi';

export type IsianUsaha = {
  nama: string; deskripsi: string; jenis: string; kategori: string; spesifik: string | null;
  bentuk_usaha: BentukUsaha | null; tahun_mulai: number | null; omzet_rentang: OmzetRentang | null;
  tenaga_kerja_rentang: TenagaKerjaRentang | null; memiliki_nib: boolean | null;
  instagram: string | null; tiktok: string | null;
  kabupaten_kota: string; kecamatan: string | null; alamat: string | null;
  nama_pemilik: string | null; nomor: string | null;
};

export function bacaIsian(fd: FormData): IsianUsaha {
  const teks = (k: string) => String(fd.get(k) ?? '').trim();
  const atauNull = (k: string) => teks(k) || null;
  const tahun = teks('tahun_mulai');
  const nib = teks('memiliki_nib');
  return {
    nama: teks('nama'), deskripsi: teks('deskripsi'), jenis: teks('jenis'), kategori: teks('kategori'),
    spesifik: atauNull('spesifik'),
    bentuk_usaha: atauNull('bentuk_usaha') as BentukUsaha | null,
    tahun_mulai: tahun && Number.isFinite(Number(tahun)) ? Number(tahun) : null,
    omzet_rentang: atauNull('omzet_rentang') as OmzetRentang | null,
    tenaga_kerja_rentang: atauNull('tenaga_kerja_rentang') as TenagaKerjaRentang | null,
    memiliki_nib: nib === '' ? null : nib === 'ya',
    instagram: atauNull('instagram'), tiktok: atauNull('tiktok'),
    kabupaten_kota: teks('kabupaten_kota'), kecamatan: atauNull('kecamatan'), alamat: atauNull('alamat'),
    nama_pemilik: atauNull('nama_pemilik'), nomor: atauNull('nomor'),
  };
}
