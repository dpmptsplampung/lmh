// Lapisan data Kelola FAQ admin (rencana refaktor 2026-11-11 tugas 8.1, SPEC bagian 5): kueri `faq_knowledge_base`, `layanan`,
// `petugas` dan pemanggil route yang sebelumnya hidup di `app/admin/chat/faq/page.tsx`
// (/api/admin/faq/embed, /api/admin/revalidasi).
//
// Aturan lapisan data:
// - Fungsi Supabase menerima SupabaseClient sebagai argumen pertama (klien browser dengan RLS pengguna); tanpa React dan tanpa
//   toast. Pemanggil yang memutuskan cara menampilkan galat.
// - Tidak pernah melempar. Hasilnya HasilFaq<T> = { data, error: null } | { data: null, error: GalatFaq }; `error.asli` =
//   galat aslinya, `error.perluMuatUlang` = tampilan klien kemungkinan basi (RLS menolak / baris tak ada).
// - `select` selalu daftar kolom eksplisit lewat konstanta KOLOM_*. Mutasi UPDATE/DELETE wajib `.select('id')` dan dicek
//   `mutasiWajibBaris` (penolakan RLS = 0 baris tanpa error, tidak boleh jadi sukses palsu).
// - Lingkup baca ditegakkan RLS (`faq_admin_all`, `faq_petugas_all`, `faq_fo_umum`); filter lingkup di sini hanya
//   mempersempit kueri supaya daftar sesuai peran.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FAQ } from '@/components/admin/faq/types';
import { MutasiError, mutasiInsert, mutasiWajibBaris, pesanMutasi, type KodeMutasi } from '@/lib/supabase/mutate';

// ---------------------------------------------------------------------------------------------------------------
// Kolom dan batas
// ---------------------------------------------------------------------------------------------------------------

export const KOLOM_FAQ = 'id, layanan_id, pertanyaan, jawaban, dasar_hukum, aktif, urutan, updated_at';
export const KOLOM_LAYANAN_FAQ = 'id, nama, chatbot_aktif';
export const KOLOM_PROFIL_FAQ = 'role, layanan_id';

/** Baris per permintaan dan batas keamanan jumlah baris yang dimuat. */
export const UKURAN_MUAT = 500;
export const BATAS_MUAT = 10_000;

/** Tag cache data publik untuk FAQ (sama dengan TAG_PUBLIK.faq di lib/data/publik-server.ts, yang server-only). */
export const TAG_FAQ_PUBLIK = 'publik-faq';

// ---------------------------------------------------------------------------------------------------------------
// Tipe
// ---------------------------------------------------------------------------------------------------------------

export interface LayananFaq {
  id: string;
  nama: string;
  chatbot_aktif: boolean;
}

/** Peran akun (`unknown` = tanpa sesi atau tanpa baris petugas) dan layanan petugas. */
export interface ProfilFaq {
  role: string;
  layananId: string | null;
}

/** Lingkup daftar FAQ yang dimuat: semua (admin), FAQ umum saja (Front Office), atau satu layanan (petugas). */
export type LingkupFaq = { jenis: 'semua' } | { jenis: 'umum' } | { jenis: 'layanan'; layananId: string };

export interface DaftarFaq {
  faq: FAQ[];
  /** Id FAQ yang belum diproses bot (embedding kosong atau perlu diulang). Kosong bila kueri keduanya gagal. */
  menungguIds: string[];
}

export interface IsianFaqData {
  pertanyaan: string;
  jawaban: string;
  dasarHukum: string | null;
  urutan: number;
}

export interface HasilProsesMassal {
  diproses: number;
  gagal: number;
  sisa: number;
}

export type JenisGalatFaq = KodeMutasi | 'http';

export interface GalatFaq {
  jenis: JenisGalatFaq;
  /** Pesan siap tampil (bahasa Indonesia). */
  pesan: string;
  asli: unknown;
  /** RLS menolak atau baris tak ada: muat ulang daftar agar tampilan tidak basi. */
  perluMuatUlang: boolean;
}

export type HasilFaq<T> = { data: T; error: null } | { data: null; error: GalatFaq };

// ---------------------------------------------------------------------------------------------------------------
// Galat
// ---------------------------------------------------------------------------------------------------------------

const ok = <T>(data: T): HasilFaq<T> => ({ data, error: null });
const gagal = <T>(jenis: JenisGalatFaq, pesan: string, asli: unknown): HasilFaq<T> => ({
  data: null,
  error: { jenis, pesan, asli, perluMuatUlang: jenis === 'ditolak' || jenis === 'tidak_ada_baris' },
});

/** Galat mutasi (MutasiError atau lemparan lain) -> galat bertipe dengan pesan siap tampil. */
function dariMutasi<T>(e: unknown, cadangan?: string): HasilFaq<T> {
  return gagal(e instanceof MutasiError ? e.kode : 'database', pesanMutasi(e, cadangan), e);
}

/** Galat baca mentah (PostgREST atau penolakan promise). Pesannya tidak ditampilkan; pemanggil memakai teks tetap. */
const dariBaca = <T>(e: unknown, pesan: string): HasilFaq<T> => gagal('database', pesan, e);

// ---------------------------------------------------------------------------------------------------------------
// Peran dan layanan
// ---------------------------------------------------------------------------------------------------------------

/**
 * Peran + layanan akun saat ini dari tabel `petugas`. Tanpa sesi atau tanpa baris petugas = sukses dengan `role: 'unknown'`
 * (memang tanpa akses). Galat jaringan/DB (selain "sesi tidak ada") = `error`, bukan "tanpa akses".
 */
export async function muatProfilFaq(sb: SupabaseClient): Promise<HasilFaq<ProfilFaq>> {
  try {
    const { data: { user }, error: userErr } = await sb.auth.getUser();
    if (userErr && userErr.name !== 'AuthSessionMissingError') return dariBaca(userErr, 'Gagal memuat hak akses.');
    if (!user) return ok({ role: 'unknown', layananId: null });
    const { data, error } = await sb.from('petugas').select(KOLOM_PROFIL_FAQ).eq('auth_user_id', user.id).maybeSingle();
    if (error) return dariBaca(error, 'Gagal memuat hak akses.');
    const p = data as { role?: string | null; layanan_id?: string | null } | null;
    return ok({ role: p?.role ?? 'unknown', layananId: p?.layanan_id ?? null });
  } catch (e) {
    return dariBaca(e, 'Gagal memuat hak akses.');
  }
}

/** Semua layanan (nama + status bot), urut nama. */
export async function muatLayananFaq(sb: SupabaseClient): Promise<HasilFaq<LayananFaq[]>> {
  try {
    const { data, error } = await sb.from('layanan').select(KOLOM_LAYANAN_FAQ).order('nama');
    if (error) return dariBaca(error, 'Gagal memuat daftar layanan.');
    return ok((data ?? []) as LayananFaq[]);
  } catch (e) {
    return dariBaca(e, 'Gagal memuat daftar layanan.');
  }
}

/** Bot hidup/mati per layanan (hanya Admin; RLS menolak yang lain dengan 0 baris -> `tidak_ada_baris`). */
export async function ubahBotLayanan(sb: SupabaseClient, layananId: string, aktif: boolean): Promise<HasilFaq<null>> {
  try {
    await mutasiWajibBaris(sb.from('layanan').update({ chatbot_aktif: aktif }).eq('id', layananId).select('id'));
    return ok(null);
  } catch (e) {
    return dariMutasi(e);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Daftar FAQ
// ---------------------------------------------------------------------------------------------------------------

type KueriBertahap = (dari: number, sampai: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>;

// Daftar dan pencarian klien memerlukan semua baris; tolak hasil parsial di atas batas keamanan.
async function muatBertahap<T>(kueri: KueriBertahap): Promise<T[]> {
  const semua: T[] = [];
  for (let dari = 0; dari <= BATAS_MUAT; dari += UKURAN_MUAT) {
    const { data, error } = await kueri(dari, dari + UKURAN_MUAT - 1);
    if (error) throw error;
    const baris = (data ?? []) as T[];
    semua.push(...baris);
    if (semua.length > BATAS_MUAT) throw new Error('Daftar FAQ melampaui batas pemuatan.');
    if (baris.length < UKURAN_MUAT) return semua;
  }
  throw new Error('Daftar FAQ melampaui batas pemuatan.');
}

/**
 * Daftar FAQ sesuai lingkup, terbaru diubah di atas. FAQ yang belum diproses bot dimuat lewat kueri kedua yang ringan
 * (hanya id) agar kolom vektor tidak ikut terbaca; kegagalannya hanya menyembunyikan lencana (daftar tetap benar).
 * Lingkup `umum` memakai IS NULL, bukan eq, karena `= NULL` tidak pernah cocok di SQL.
 */
export async function muatDaftarFaq(sb: SupabaseClient, lingkup: LingkupFaq): Promise<HasilFaq<DaftarFaq>> {
  try {
    const [faq, menunggu] = await Promise.all([
      muatBertahap<FAQ>((dari, sampai) => {
        const dasar = sb.from('faq_knowledge_base').select(KOLOM_FAQ);
        return (lingkup.jenis === 'layanan' ? dasar.eq('layanan_id', lingkup.layananId) : lingkup.jenis === 'umum' ? dasar.is('layanan_id', null) : dasar)
          .order('updated_at', { ascending: false }).order('id', { ascending: true }).range(dari, sampai);
      }),
      muatBertahap<{ id: string }>((dari, sampai) => {
        const dasar = sb.from('faq_knowledge_base').select('id');
        return (lingkup.jenis === 'layanan' ? dasar.eq('layanan_id', lingkup.layananId) : lingkup.jenis === 'umum' ? dasar.is('layanan_id', null) : dasar)
          .or('embedding.is.null,perlu_embed_ulang.eq.true').order('id', { ascending: true }).range(dari, sampai);
      }).catch(() => [] as Array<{ id: string }>),
    ]);
    return ok({ faq, menungguIds: menunggu.map((r) => r.id) });
  } catch (e) {
    return dariBaca(e, 'Daftar FAQ gagal dimuat.');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Mutasi FAQ
// ---------------------------------------------------------------------------------------------------------------

/** Tambah FAQ baru (aktif). `layananId: null` = FAQ umum. Mengembalikan id baris baru (null bila tidak dikembalikan). */
export async function tambahFaq(
  sb: SupabaseClient,
  p: IsianFaqData & { layananId: string | null },
): Promise<HasilFaq<{ id: string | null }>> {
  try {
    const baris = await mutasiInsert<{ id: string }>(
      sb
        .from('faq_knowledge_base')
        .insert({
          layanan_id: p.layananId,
          pertanyaan: p.pertanyaan,
          jawaban: p.jawaban,
          dasar_hukum: p.dasarHukum,
          urutan: p.urutan,
          aktif: true,
        })
        .select('id'),
    );
    return ok({ id: baris[0]?.id ?? null });
  } catch (e) {
    return dariMutasi(e, 'Gagal menyimpan FAQ.');
  }
}

/** Ubah isi FAQ. `hapusEmbedding` bila teks berubah: hasil pemrosesan lama tidak berlaku, kosongkan agar diproses ulang. */
export async function ubahFaq(
  sb: SupabaseClient,
  p: IsianFaqData & { id: string; hapusEmbedding: boolean },
): Promise<HasilFaq<null>> {
  try {
    await mutasiWajibBaris(
      sb
        .from('faq_knowledge_base')
        .update({
          pertanyaan: p.pertanyaan,
          jawaban: p.jawaban,
          dasar_hukum: p.dasarHukum,
          urutan: p.urutan,
          ...(p.hapusEmbedding ? { embedding: null } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', p.id)
        .select('id'),
    );
    return ok(null);
  } catch (e) {
    return dariMutasi(e, 'Gagal menyimpan FAQ.');
  }
}

/** Aktif/Nonaktif satu FAQ (aturan akses sama dengan menyimpan; RLS menegakkannya). */
export async function ubahStatusFaq(sb: SupabaseClient, id: string, aktif: boolean): Promise<HasilFaq<null>> {
  try {
    await mutasiWajibBaris(
      sb.from('faq_knowledge_base').update({ aktif, updated_at: new Date().toISOString() }).eq('id', id).select('id'),
    );
    return ok(null);
  } catch (e) {
    return dariMutasi(e, 'Gagal mengubah status FAQ.');
  }
}

/** Hapus FAQ. 0 baris terhapus (RLS menolak diam-diam / sudah tidak ada) = gagal, bukan sukses. */
export async function hapusFaq(sb: SupabaseClient, id: string): Promise<HasilFaq<null>> {
  try {
    await mutasiWajibBaris(sb.from('faq_knowledge_base').delete().eq('id', id).select('id'));
    return ok(null);
  } catch (e) {
    return dariMutasi(e, 'Gagal menghapus FAQ.');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Route: pemrosesan bot (embedding) dan pembuangan cache publik
// ---------------------------------------------------------------------------------------------------------------

export type HasilProsesFaq = 'diproses' | 'sudah_diproses';

async function bacaJson(res: Response): Promise<Record<string, unknown> | null> {
  const json: unknown = await res.json().catch(() => null);
  return typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : null;
}

/**
 * Proses (embedding) satu FAQ lewat route khusus: server memeriksa hak akses dan hanya memproses FAQ ini. 409 = sudah
 * diproses (mis. Admin lebih dulu) dan dianggap sukses. Galat: pesan server dipakai hanya untuk 429; selain itu `pesanGagal`.
 */
export async function prosesEmbedFaq(faqId: string, pesanGagal: string): Promise<HasilFaq<HasilProsesFaq>> {
  try {
    const res = await fetch('/api/admin/faq/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ faqId }),
    });
    if (res.ok) return ok('diproses');
    if (res.status === 409) return ok('sudah_diproses');
    const data = await bacaJson(res);
    const pesanServer = res.status === 429 && typeof data?.error === 'string' && data.error ? data.error : pesanGagal;
    return gagal('http', pesanServer, res);
  } catch (e) {
    return gagal('http', pesanGagal, e);
  }
}

const PESAN_PROSES_MASSAL_GAGAL = 'Gagal memproses FAQ. Coba lagi beberapa saat lagi.';
const angka = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

/** Cadangan Admin: proses semua FAQ yang menunggu (maks 50 per panggilan, dibatasi server). */
export async function prosesEmbedMassal(): Promise<HasilFaq<HasilProsesMassal>> {
  try {
    const res = await fetch('/api/admin/faq/embed', { method: 'POST' });
    const data = await bacaJson(res);
    if (!res.ok) {
      return gagal('http', typeof data?.error === 'string' && data.error ? data.error : PESAN_PROSES_MASSAL_GAGAL, res);
    }
    return ok({ diproses: angka(data?.embedded), gagal: angka(data?.failed), sisa: angka(data?.remaining) });
  } catch (e) {
    return gagal('http', PESAN_PROSES_MASSAL_GAGAL, e);
  }
}

/**
 * Buang cache FAQ publik (POST /api/admin/revalidasi, tag `publik-faq`) agar beranda/chat publik memuat isi terbaru.
 * Hanya Admin yang diizinkan route; gagal (403, jaringan) bukan masalah bagi aksi yang memicunya: cache publik tetap
 * kedaluwarsa sendiri dalam 60 detik. Pemanggil tidak menampilkan galat dari sini.
 */
export async function buangCacheFaqPublik(): Promise<HasilFaq<null>> {
  try {
    const res = await fetch('/api/admin/revalidasi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: TAG_FAQ_PUBLIK }),
    });
    if (!res.ok) return gagal('http', 'Cache publik belum dibuang.', res);
    return ok(null);
  } catch (e) {
    return gagal('http', 'Cache publik belum dibuang.', e);
  }
}
