import type { DokumenPublik } from '@/lib/investasi/dokumen';

/** Bentuk minimal dokumen untuk penampil dan formulir minat. */
export type DokumenBuka = Pick<DokumenPublik, 'id' | 'judul' | 'jumlah_halaman' | 'kategori'>;

/** Satu aturan kesiapan baca untuk semua permukaan: siap bila ada minimal satu halaman yang sudah dirender. */
export const dokumenSiap = (d: Pick<DokumenPublik, 'jumlah_halaman'>): boolean => d.jumlah_halaman > 0;

/** Satuan tunggal untuk kartu, sorotan, dan penampil: Peta Potensi (slideshow) "slide", selain itu "halaman". */
export const satuanHalaman = (kategori?: string): 'slide' | 'halaman' => (kategori === 'Peta Potensi' ? 'slide' : 'halaman');

/** "24 halaman"; untuk Peta Potensi (slideshow) "24 slide". */
export function teksHalaman(d: Pick<DokumenPublik, 'jumlah_halaman' | 'kategori'>): string | null {
  if (d.jumlah_halaman <= 0) return null;
  return `${d.jumlah_halaman} ${satuanHalaman(d.kategori)}`;
}

/** Sampul hanya dimuat bila dokumen siap baca (kontrak data: `sampul` null = belum siap). */
export const sampulDokumen = (d: Pick<DokumenPublik, 'sampul' | 'jumlah_halaman'>): string | null =>
  dokumenSiap(d) ? d.sampul : null;
