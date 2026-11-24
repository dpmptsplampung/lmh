import type { DokumenPublik } from '@/lib/investasi/dokumen';

/** Nomor halaman dari `?halaman=`: bilangan bulat positif; selain itu kembali ke 1. */
export function nomorHalaman(mentah: string | string[] | undefined): number {
  const teks = Array.isArray(mentah) ? mentah[0] : mentah;
  if (!teks || !/^\d{1,6}$/.test(teks)) return 1;
  return Math.max(1, Number(teks));
}

/**
 * Pisahkan sorotan Peta Potensi dari daftar halaman 1 supaya tidak tampil dua kali. Sumber utama: `petaPotensi` dari
 * loader hub (dicari di seluruh katalog); cadangan: dokumen bertanda `sorotan` pada halaman ini. Halaman lanjutan tanpa sorotan.
 */
export function pisahSorotan(dokumen: DokumenPublik[], petaPotensi: DokumenPublik | null, halamanPertama: boolean) {
  if (!halamanPertama) return { sorotan: null, sisa: dokumen };
  const sorotan = petaPotensi ?? dokumen.find(d => d.sorotan) ?? null;
  return { sorotan, sisa: sorotan ? dokumen.filter(d => d.id !== sorotan.id) : dokumen };
}
