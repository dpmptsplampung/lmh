// Pembantu bersama FormUsaha (pemilik) dan ProfilForm (petugas).
import type { FotoInput, ProdukInput } from '@/lib/umkm-katalog/schemas';
import type { Foto, Produk } from '@/lib/umkm-katalog/types';
import type { ZodError } from 'zod';

type FotoTersimpan = Pick<Foto, 'asal' | 'url' | 'r2_key'> & Partial<Pick<Foto, 'utama' | 'produk_urutan'>>;

const keFotoInput = (f: FotoTersimpan): FotoInput => ({
  asal: f.asal, url: f.url, r2_key: f.r2_key, ...(f.utama ? { utama: true } : {}),
});

/** Foto profil: yang tidak menunjuk produk. */
export function fotoProfilAwal(foto: readonly FotoTersimpan[] | undefined): FotoInput[] {
  return (foto ?? []).filter((f) => f.produk_urutan == null).map(keFotoInput);
}

/** Produk beserta satu foto masing-masing (foto produk diikat lewat `produk_urutan`). */
export function produkAwal(
  produk: readonly Produk[] | undefined, foto: readonly FotoTersimpan[] | undefined,
): ProdukInput[] {
  return (produk ?? []).map((p) => {
    const f = (foto ?? []).find((x) => x.produk_urutan === p.urutan);
    const { urutan: _urutan, ...isi } = p;
    void _urutan;
    return { ...isi, foto: f ? { asal: f.asal, url: f.url, r2_key: f.r2_key } : null };
  });
}

/** Kunci galat: `kolom` untuk isian biasa, `produk.<indeks>.<kolom>` untuk produk, `foto` untuk semua foto profil. */
export function galatDariZod(error: ZodError): Record<string, string> {
  const hasil: Record<string, string> = {};
  for (const isu of error.issues) {
    const [awal, indeks, kolom] = isu.path;
    const kunci = awal === 'produk' && typeof indeks === 'number'
      ? `produk.${indeks}.${kolom === undefined ? 'nama' : String(kolom)}`
      : String(awal);
    // Pesan khusus (custom) sudah berbahasa Indonesia dan menjelaskan perbaikannya.
    hasil[kunci] ??= isu.code === 'custom' ? isu.message : 'Periksa isian ini dan batas panjangnya.';
  }
  return hasil;
}
