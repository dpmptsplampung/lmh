import type { DokumenPublik } from '@/lib/investasi/dokumen';
import { BerkasTautanSchema, urlTautanAman, type TautanHalaman } from '@/lib/investasi/tautan';

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

/** Satu area klik siap render (koordinat pecahan 0..1 dari kiri-atas gambar). */
export type TautanTampil = { id: string; x: number; y: number; w: number; h: number } & (
  | { jenis: 'internal'; ke: number }
  | { jenis: 'luar'; url: string; host: string }
);

/** Validasi respons /links; bentuk tak dikenal = tanpa tautan (pembacaan tidak boleh terganggu). */
export function uraiBerkasTautan(data: unknown): TautanHalaman[] {
  const r = BerkasTautanSchema.safeParse(data);
  return r.success ? r.data.tautan : [];
}

/**
 * Kelompokkan per halaman. Tautan internal (`ke` dalam rentang, bukan ke slide yang sama) menang atas URL;
 * URL hanya lolos bila skemanya http(s). Sisanya dibuang.
 */
export function kelompokkanTautan(tautan: TautanHalaman[], jumlahHalaman: number): Map<number, TautanTampil[]> {
  const peta = new Map<number, TautanTampil[]>();
  tautan.forEach((t, i) => {
    if (t.hal < 1 || t.hal > jumlahHalaman) return;
    const dasar = { id: `${t.hal}-${i}`, x: t.x, y: t.y, w: Math.min(t.w, 1 - t.x), h: Math.min(t.h, 1 - t.y) };
    let item: TautanTampil | null = null;
    if (t.ke !== undefined) {
      if (t.ke <= jumlahHalaman && t.ke !== t.hal) item = { ...dasar, jenis: 'internal', ke: t.ke };
    } else {
      const url = urlTautanAman(t.url);
      if (url) item = { ...dasar, jenis: 'luar', url, host: new URL(url).hostname };
    }
    if (!item) return;
    const daftar = peta.get(t.hal);
    if (daftar) daftar.push(item);
    else peta.set(t.hal, [item]);
  });
  return peta;
}

/** Halaman yang dipramuat setelah halaman aktif siap: hanya satu langkah ke depan lalu satu ke belakang. */
export function tetanggaPrefetch(halaman: number, jumlahHalaman: number): number[] {
  return [halaman + 1, halaman - 1].filter(n => n >= 1 && n <= jumlahHalaman);
}
