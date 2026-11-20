export const KOLOM_DOKUMEN_GALERI =
  'id, judul, kategori, urutan_tampil, file_path, jumlah_halaman, status, deskripsi, nilai_investasi, image_url, halaman_selesai, galat';

export interface GalleryDoc {
  id: string;
  judul: string;
  kategori: string | null;
  urutan_tampil: number;
  file_path: string;
  jumlah_halaman: number;
  status: 'aktif' | 'nonaktif' | 'diproses' | 'gagal';
  deskripsi: string | null;
  nilai_investasi: string | null;
  image_url: string | null;
  halaman_selesai: number;
  galat: string | null;
}

export interface GalleryForm {
  judul: string;
  kategori: string;
  urutan_tampil: number;
  jumlah_halaman: number;
  deskripsi: string;
  nilai_investasi: string;
  image_url: string;
  file_path: string;
  status: 'aktif' | 'nonaktif' | 'diproses' | 'gagal';
}

export const emptyForm: GalleryForm = {
  judul: '',
  kategori: '',
  urutan_tampil: 1,
  jumlah_halaman: 0,
  deskripsi: '',
  nilai_investasi: '',
  image_url: '',
  file_path: '',
  status: 'aktif',
};

