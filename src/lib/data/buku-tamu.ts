// Lapisan data Buku Tamu (UI staf Admin/Front Office). Memanggil API `/api/admin/buku-tamu*`
// (kontrak: .tim/audit-petugas-fo/BACKEND-G6.md). Tanpa React dan tanpa toast; tidak pernah melempar:
// hasilnya Hasil<T> = { data, error: null } | { data: null, error: string }.
import type { Hasil } from './referensi';

export type { Hasil };

export const LIMIT_BUKU_TAMU = 50;
/** Batas baris ekspor di server; dipakai untuk teks peringatan terpotong. */
export const MAKS_BARIS_EKSPOR = 50_000;

export type FormatUnduh = 'xlsx' | 'csv';

export interface TamuBuku {
  id: string;
  nama: string;
  instansi: string | null;
  no_hp: string | null;
  /** Nama petugas referensi bila ada, selain itu teks bebas. */
  bertemu: string;
  tujuan: string | null;
  waktu_masuk: string;
  waktu_keluar: string | null;
  menemui_petugas_id: string | null;
  dicatat_oleh: string | null;
  dicatat_nama: string | null;
}

export interface FilterBukuTamu {
  /** YYYY-MM-DD (WIB), termasuk. */
  dari: string;
  sampai: string;
  /** Kata kunci (nama, asal, yang ditemui); kosong = tanpa pencarian. */
  q: string;
}

export interface MasukanTamu {
  nama: string;
  instansi: string;
  no_hp: string;
  bertemu: string;
  menemui_petugas_id?: string;
  tujuan?: string;
}

export interface BerkasUnduhan {
  blob: Blob;
  nama: string;
  terpotong: boolean;
}

const GALAT_JARINGAN = 'Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.';

/** Query string filter (dipakai daftar dan ekspor). */
export function paramFilter(f: FilterBukuTamu): URLSearchParams {
  const sp = new URLSearchParams({ dari: f.dari, sampai: f.sampai });
  if (f.q.trim()) sp.set('q', f.q.trim());
  return sp;
}

async function badanGalat(res: Response, cadangan: string): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { error?: unknown };
  return typeof j.error === 'string' && j.error ? j.error : cadangan;
}

async function kirimJson<T>(url: string, method: string, body: unknown, cadangan: string): Promise<Hasil<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { data: null, error: await badanGalat(res, cadangan) };
    return { data: (await res.json().catch(() => ({}))) as T, error: null };
  } catch {
    return { data: null, error: GALAT_JARINGAN };
  }
}

/** Satu halaman daftar (halaman 1-based, sesuai API). */
export async function muatBukuTamu(
  filter: FilterBukuTamu,
  halaman: number,
  signal?: AbortSignal,
): Promise<Hasil<{ items: TamuBuku[]; total: number }>> {
  const sp = paramFilter(filter);
  sp.set('page', String(halaman));
  sp.set('limit', String(LIMIT_BUKU_TAMU));
  try {
    const res = await fetch(`/api/admin/buku-tamu?${sp}`, { signal });
    if (!res.ok) return { data: null, error: await badanGalat(res, 'Gagal memuat buku tamu') };
    const j = (await res.json().catch(() => ({}))) as { items?: TamuBuku[]; total?: number };
    return { data: { items: j.items ?? [], total: j.total ?? 0 }, error: null };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return { data: null, error: 'Dibatalkan' };
    return { data: null, error: GALAT_JARINGAN };
  }
}

export async function catatTamu(masukan: MasukanTamu): Promise<Hasil<{ tamu: TamuBuku }>> {
  return kirimJson('/api/admin/buku-tamu', 'POST', masukan, 'Gagal mencatat tamu');
}

/** Catat waktu keluar (waktu server). Mengulang sesudah berhasil mengembalikan waktu pertama. */
export async function catatKeluar(id: string): Promise<Hasil<{ tamu: { id: string; waktu_keluar: string } }>> {
  return kirimJson('/api/admin/buku-tamu', 'PATCH', { id }, 'Gagal mencatat waktu keluar');
}

/** Unduh berkas sesuai filter. Galat server (termasuk audit ekspor gagal) = tanpa berkas. */
export async function unduhBukuTamu(filter: FilterBukuTamu, format: FormatUnduh): Promise<Hasil<BerkasUnduhan>> {
  const sp = paramFilter(filter);
  sp.set('format', format);
  try {
    const res = await fetch(`/api/admin/buku-tamu/export?${sp}`);
    if (!res.ok) {
      const cadangan = res.status >= 500
        ? 'Unduhan dibatalkan karena berkas atau pencatatan audit ekspor gagal. Coba lagi.'
        : 'Gagal mengunduh buku tamu';
      return { data: null, error: await badanGalat(res, cadangan) };
    }
    const blob = await res.blob();
    const nama = /filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') ?? '')?.[1]
      ?? `buku-tamu-${filter.dari}-sd-${filter.sampai}.${format}`;
    return { data: { blob, nama, terpotong: res.headers.get('X-Rekap-Truncated') === 'true' }, error: null };
  } catch {
    return { data: null, error: GALAT_JARINGAN };
  }
}
