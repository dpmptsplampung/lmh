// Pencarian pengunjung lama untuk Front Office/admin (Fase 6, migrasi 202611010001). Pencarian dan pengambilan identitas
// penuh berjalan lewat RPC SECURITY DEFINER `fo_cari_pengunjung` / `fo_ambil_pengunjung` (tidak membaca tabel langsung):
// server memeriksa peran, batas minimal 3, hasil maks 5 dengan HP disamarkan, dan data teranonimkan tidak muncul.
// Semua kegagalan dipetakan ke status (tidak melempar) agar formulir walk-in tetap bisa dipakai.
import type { SupabaseClient } from '@supabase/supabase-js';
import { KATEGORI_WALKIN } from '@/lib/fo/walkin';

export const MIN_KARAKTER_CARI = 3;
export const MAKS_SARAN = 5;

export interface SaranPengunjung {
  /** id kunjungan (opak) untuk mengambil identitas lengkap. */
  id: string;
  nama: string;
  /** HP disamarkan dari server, mis. 0812****789 ('' bila tak ada). */
  hpSamar: string;
  asal: string;
  /** Tanggal kunjungan terakhir (YYYY-MM-DD, WIB). */
  tanggal: string;
}

export interface PengunjungTerpilih {
  nama: string;
  asal_instansi: string;
  /** Hanya nilai kategori yang dikenal; selain itu ''. */
  kategori: string;
  email: string;
  kontak_hp: string;
}

export type HasilCari =
  | { status: 'ok'; hasil: SaranPengunjung[] }
  | { status: 'tidak_tersedia' }
  | { status: 'sesi' }
  | { status: 'galat' };

export type HasilAmbil =
  | { status: 'ok'; data: PengunjungTerpilih }
  | { status: 'tidak_ada' }
  | { status: 'dibatasi' }
  | { status: 'sesi' }
  | { status: 'galat' };

type KlienRpc = Pick<SupabaseClient, 'rpc'>;
type GalatSupabase = { code?: string; message?: string } | null;

const teks = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** 'pendek' = belum cukup untuk mencari; 'hp' = hanya angka/pemisah (>= 3 digit); 'nama' = lainnya (>= 3 karakter). */
export function jenisQuery(q: string): 'pendek' | 'nama' | 'hp' {
  const s = q.trim();
  if (/^[0-9+()\s-]+$/.test(s)) {
    let d = s.replace(/\D/g, '');
    if (d.startsWith('62')) d = `0${d.slice(2)}`;
    return d.length >= MIN_KARAKTER_CARI ? 'hp' : 'pendek';
  }
  return Array.from(s).length >= MIN_KARAKTER_CARI ? 'nama' : 'pendek';
}

function rpcBelumAda(e: GalatSupabase): boolean {
  if (!e) return false;
  const pesan = e.message ?? '';
  return e.code === 'PGRST202' || e.code === '42883' || /could not find the function|does not exist/i.test(pesan);
}

const kodePesan = (e: GalatSupabase): string | null => /^([A-Z_]+):/.exec(e?.message ?? '')?.[1] ?? null;

function petakanSaran(baris: unknown): SaranPengunjung | null {
  if (typeof baris !== 'object' || baris === null) return null;
  const r = baris as Record<string, unknown>;
  const id = teks(r.id);
  const nama = teks(r.nama);
  const asal = teks(r.asal_instansi);
  if (!id || !nama || !asal) return null;
  return { id, nama, hpSamar: teks(r.hp_samar), asal, tanggal: teks(r.tanggal) };
}

/** Memasang AbortSignal bila builder-nya mendukung (supabase-js); tiruan di test cukup promise biasa. */
function denganSinyal<T>(permintaan: T, sinyal?: AbortSignal): T {
  const b = permintaan as unknown as { abortSignal?: (s: AbortSignal) => T };
  return sinyal && typeof b.abortSignal === 'function' ? b.abortSignal(sinyal) : permintaan;
}

export async function cariPengunjung(supabase: KlienRpc, q: string, sinyal?: AbortSignal): Promise<HasilCari> {
  if (jenisQuery(q) === 'pendek') return { status: 'ok', hasil: [] };
  try {
    const { data, error } = (await denganSinyal(supabase.rpc('fo_cari_pengunjung', { p_q: q.trim() }), sinyal)) as {
      data: unknown;
      error: GalatSupabase;
    };
    if (error) {
      if (rpcBelumAda(error)) return { status: 'tidak_tersedia' };
      const kode = kodePesan(error);
      if (kode === 'SESI_TIDAK_SAH') return { status: 'sesi' };
      if (kode === 'FORBIDDEN') return { status: 'tidak_tersedia' };
      return { status: 'galat' };
    }
    if (!Array.isArray(data)) return { status: 'ok', hasil: [] };
    const hasil: SaranPengunjung[] = [];
    for (const b of data) {
      const s = petakanSaran(b);
      if (s) hasil.push(s);
      if (hasil.length >= MAKS_SARAN) break;
    }
    return { status: 'ok', hasil };
  } catch {
    return { status: 'galat' };
  }
}

/**
 * Apakah fitur pencarian bisa dipakai akun ini? Probe dengan query kosong (server mengembalikan 0 baris tanpa menyentuh
 * data). false bila RPC belum diterapkan atau akun bukan FO/admin; galat sementara dianggap tersedia (dicoba lagi saat mengetik).
 */
export async function periksaKetersediaan(supabase: KlienRpc): Promise<boolean> {
  try {
    const { error } = (await supabase.rpc('fo_cari_pengunjung', { p_q: '' })) as { error: GalatSupabase };
    if (!error) return true;
    if (rpcBelumAda(error) || kodePesan(error) === 'FORBIDDEN') return false;
    return true;
  } catch {
    return true;
  }
}

export async function ambilPengunjung(supabase: KlienRpc, id: string): Promise<HasilAmbil> {
  try {
    const { data, error } = (await supabase.rpc('fo_ambil_pengunjung', { p_id: id })) as {
      data: unknown;
      error: GalatSupabase;
    };
    if (error) {
      const kode = kodePesan(error);
      if (kode === 'NOT_FOUND') return { status: 'tidak_ada' };
      if (kode === 'RATE_LIMIT') return { status: 'dibatasi' };
      if (kode === 'SESI_TIDAK_SAH') return { status: 'sesi' };
      return { status: 'galat' };
    }
    const r = Array.isArray(data) ? data[0] : null;
    if (typeof r !== 'object' || r === null) return { status: 'tidak_ada' };
    const b = r as Record<string, unknown>;
    const nama = teks(b.nama);
    const asal = teks(b.asal_instansi);
    if (!nama || !asal) return { status: 'tidak_ada' };
    const kategori = teks(b.kategori);
    return {
      status: 'ok',
      data: {
        nama,
        asal_instansi: asal,
        kategori: (KATEGORI_WALKIN as string[]).includes(kategori) ? kategori : '',
        email: teks(b.email),
        kontak_hp: teks(b.kontak_hp),
      },
    };
  } catch {
    return { status: 'galat' };
  }
}
