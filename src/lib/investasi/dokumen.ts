export const KATEGORI_DOKUMEN = ['Peta Potensi', 'Kajian', 'Profil', 'Lainnya'] as const;
export type KategoriDokumen = typeof KATEGORI_DOKUMEN[number];
export const POLA_KATEGORI_PETA = '%peta%potensi%';
export const MAKS_HALAMAN_TERSAJI = 200;

export type DokumenPublik = {
  id: string;
  judul: string;
  kategori: KategoriDokumen;
  deskripsi: string | null;
  nilai_investasi: string | null;
  mata_uang: 'IDR' | 'USD' | null;
  jumlah_halaman: number;
  sampul: string | null;
  urutan_tampil: number;
  sorotan: boolean;
};

export function kategoriDokumen(lama: string | null): KategoriDokumen {
  const kategori = (lama ?? '').trim().toLowerCase();
  if (/peta[\s\S]*potensi/.test(kategori)) return 'Peta Potensi';
  if (/\bkajian\b|\bstudi kelayakan\b|\bfeasibility study\b/.test(kategori)) return 'Kajian';
  if (/\bprofil\b|\bprofile\b/.test(kategori)) return 'Profil';
  return 'Lainnya';
}

type HalamanDokumen = {
  jumlah_halaman: number | null;
  halaman_gambar: (string | null)[] | null;
};

export function jumlahHalamanSiapBaca(dokumen: HalamanDokumen): number {
  if (!Array.isArray(dokumen.halaman_gambar) || !Number.isInteger(dokumen.jumlah_halaman)) return 0;
  const batas = Math.min(dokumen.jumlah_halaman ?? 0, dokumen.halaman_gambar.length, MAKS_HALAMAN_TERSAJI);
  let siap = 0;
  while (siap < batas && dokumen.halaman_gambar[siap]?.trim()) siap++;
  return siap;
}

export function mataUangDokumen(nilai: string | null): DokumenPublik['mata_uang'] {
  if (!nilai) return null;
  const idr = /\bIDR\b|\bRp(?=\s|\.|\d|$)/i.test(nilai);
  const usd = /\bUSD\b|\bUS\$/i.test(nilai);
  return idr === usd ? null : idr ? 'IDR' : 'USD';
}
