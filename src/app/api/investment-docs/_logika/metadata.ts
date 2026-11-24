import { z } from 'zod';
import { kategoriDokumen } from '@/lib/investasi/dokumen';

const teks = (maks: number, min = 0) => z.string()
  .refine(v => !Array.from(v).some(c => (c.charCodeAt(0) < 32 && c !== '\n') || c.charCodeAt(0) === 127))
  .trim().min(min).max(maks);

export const urutanDokumen = z.int32().min(0);
export const statusDokumenTerbit = z.enum(['aktif', 'nonaktif']);
export const metadataDokumen = {
  judul: teks(255, 1),
  kategori: teks(100).nullable().transform(kategoriDokumen),
  deskripsi: teks(2000),
  nilai_investasi: teks(100),
  image_url: z.url(),
  urutan_tampil: urutanDokumen,
};
