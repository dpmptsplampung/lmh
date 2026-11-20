import { MAKS_GAMBAR_PTSP } from '@/lib/investasi/konstanta';
import type { GambarIpro } from '@/lib/data/investasi';
import type { SumberIpro } from './nilai-form';

export const MAKS_BYTE_MENTAH = 8 * 1024 * 1024;
export const MIME_GAMBAR = ['image/jpeg', 'image/png', 'image/webp'] as const;
const EKSTENSI: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export const batasGambar = (sumber: SumberIpro) => (sumber === 'foila' ? 1 : MAKS_GAMBAR_PTSP);

// null = berkas layak diunggah; selain itu pesan untuk pengelola.
export function periksaBerkasGambar(berkas: { type: string; size: number }): string | null {
  if (!(MIME_GAMBAR as readonly string[]).includes(berkas.type)) return 'Format gambar harus JPG, PNG, atau WebP.';
  if (berkas.size <= 0) return 'Berkas gambar kosong.';
  if (berkas.size > MAKS_BYTE_MENTAH) return 'Ukuran gambar maksimal 8 MB.';
  return null;
}

// Path mentah yang dikenali presign: <proyek_id>/<uuid>.<ext> (lihat pathMentahIproSah).
export const pathMentah = (proyekId: string, mime: string, uuid: string) => `${proyekId}/${uuid}.${EKSTENSI[mime] ?? 'jpg'}`;

// Urutan tampil = posisi dalam daftar. Mengembalikan hanya gambar yang nilai urutannya harus berubah
// setelah gambar ke-`dari` dipindah ke posisi `ke` (nilai ganda dinormalkan sekalian).
export function rencanaUrutan(gambar: Pick<GambarIpro, 'id' | 'urutan'>[], dari: number, ke: number): { id: string; urutan: number }[] {
  if (dari < 0 || ke < 0 || dari >= gambar.length || ke >= gambar.length || dari === ke) return [];
  const baru = [...gambar];
  const [dipindah] = baru.splice(dari, 1);
  baru.splice(ke, 0, dipindah);
  return baru.flatMap((g, i) => (g.urutan === i ? [] : [{ id: g.id, urutan: i }]));
}
