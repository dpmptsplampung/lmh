import { JENIS_USAHA, KATEGORI_PER_JENIS, type JenisUsaha } from './taksonomi';

// Urutan chip jenis di katalog publik. Nilai di DB/API tetap "Produk"; label tampilan "Produksi".
export const URUTAN_JENIS: readonly JenisUsaha[] = ['Bahan Baku', 'Produk', 'Jasa'];

export const LABEL_JENIS: Readonly<Record<JenisUsaha, string>> = {
  'Bahan Baku': 'Bahan Baku', Produk: 'Produksi', Jasa: 'Jasa',
};

export function labelJenis(jenis: string): string {
  return (LABEL_JENIS as Record<string, string>)[jenis] ?? jenis;
}

/** Kategori milik jenis (urutan taksonomi) yang juga ada di `tersedia`. Jenis kosong/tidak sah -> []. */
export function kategoriUntuk(jenis: string, tersedia: readonly string[]): string[] {
  if (!(JENIS_USAHA as readonly string[]).includes(jenis)) return [];
  return KATEGORI_PER_JENIS[jenis as JenisUsaha].filter(k => tersedia.includes(k));
}

export function gantiJenis<T extends { jenis: string; kategori: string; spesifik: string }>(
  filters: T, jenis: string,
): T {
  return { ...filters, jenis, kategori: '', spesifik: '' };
}
