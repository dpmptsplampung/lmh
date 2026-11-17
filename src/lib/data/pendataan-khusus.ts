// Lapisan data Mulai Layanan dua langkah dan draf Pendataan Khusus (G5; migrasi 202611160002).
//
// Aturan lapisan data (lihat lib/data/antrean.ts): fungsi menerima SupabaseClient sebagai argumen pertama, tanpa React dan
// tanpa toast, tidak pernah melempar: hasilnya HasilKhusus<T> = { data, error: null } | { data: null, error }. `error.asli`
// membawa objek galat aslinya (memuat `message` RPC) agar pemanggil memilah pesan lewat pesanGalatLangkah.
// RPC dipanggil dengan sesi pengguna (RLS + guard kepemilikan di DB), bukan service role.
import type { SupabaseClient } from '@supabase/supabase-js';
import { objekBelumAda } from '@/lib/akses-data/galat';
import { petaFieldKhusus, type FieldKhusus } from '@/lib/pendataan-khusus/jenis';
import { pesanMutasi } from '@/lib/supabase/mutate';
import { muatCatatanEskalasi, type CatatanEskalasi } from './antrean';

// ── Kolom ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Tiket + kunjungan untuk langkah 1 "Data dari Front Office" (baca-saja). */
export const KOLOM_TIKET_DATA_FO = `
  id, penanganan_asal_id, waktu_terbit,
  kunjungan:kunjungan_id(nama, kontak_hp, email, asal_instansi, kategori, keperluan, asal, waktu_masuk, pencatat:dibuat_oleh(nama))
`.replace(/\s+/g, ' ').trim();

// ── Tipe ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface GalatKhusus {
  pesan: string;
  asli: unknown;
}

export type HasilKhusus<T> = { data: T; error: null } | { data: null; error: GalatKhusus };

const ok = <T>(data: T): HasilKhusus<T> => ({ data, error: null });
const gagal = <T>(e: unknown): HasilKhusus<T> => ({ data: null, error: { pesan: pesanMutasi(e), asli: e } });

/** Definisi isian aktif sebuah Layanan. `tersedia` false = RPC belum ada (migrasi belum diterapkan): alur lama. */
export interface DefinisiKhusus {
  fields: FieldKhusus[];
  tersedia: boolean;
}

export interface DrafKhusus {
  /** Objek penuh: kunci UUID isian, nilai bertipe JSON. */
  jawaban: Record<string, unknown>;
  updatedAt: string | null;
}

export interface DataDariFo {
  nama: string;
  kontakHp: string | null;
  email: string | null;
  asalInstansi: string | null;
  kategori: string | null;
  keperluan: string | null;
  asal: string | null;
  /** Jam kunjungan terdaftar (kunjungan.waktu_masuk); jatuh ke waktu terbit tiket. */
  waktuDaftar: string | null;
  /** Nama petugas yang mencatat kunjungan (kunjungan.dibuat_oleh); jatuh ke nama FO tahap eskalasi. */
  pencatatNama: string | null;
  /** Catatan eskalasi FO (topik + catatan tahap asal); null bila tiket bukan hasil eskalasi atau tahap tak terbaca. */
  eskalasi: CatatanEskalasi | null;
  hasilEskalasi: boolean;
}

export interface ParamSelesaiKhusus {
  tiketId: string;
  /** Null = server memakai topik seed "Lainnya" (hanya bila Layanan punya isian Khusus aktif). */
  topikId: string | null;
  catatan: string | null;
  /** Null/kosong = server memakai draf terbaru; objek tidak kosong = mengganti draf untuk finalisasi ini. */
  khusus: Record<string, unknown> | null;
  /** Hanya `{ email }` yang dikirim modal selesai. */
  identitas: { email: string } | null;
}

// ── Definisi, draf ────────────────────────────────────────────────────────────────────────────────────────────

/** `pendataan_khusus_definisi`: isian terlihat (label/opsi/urutan terkini). `[]` = tanpa isian aktif atau saklar mati. */
export async function muatDefinisiKhusus(sb: SupabaseClient, layananId: string): Promise<HasilKhusus<DefinisiKhusus>> {
  try {
    const { data, error } = await sb.rpc('pendataan_khusus_definisi', { p_layanan: layananId });
    if (error) {
      // Migrasi belum diterapkan: fitur tidak tersedia, alur lama berjalan.
      if (objekBelumAda(error)) return ok({ fields: [], tersedia: false });
      return gagal(error);
    }
    const baris = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    return ok({ fields: baris.map(petaFieldKhusus).filter((f) => !f.tersembunyi), tersedia: true });
  } catch (e) {
    return gagal(e);
  }
}

/** `pendataan_khusus_draf_baca`: `data: null` tanpa galat = tiket belum punya draf. */
export async function muatDrafKhusus(sb: SupabaseClient, tiketId: string): Promise<HasilKhusus<DrafKhusus | null>> {
  try {
    const { data, error } = await sb.rpc('pendataan_khusus_draf_baca', { p_tiket: tiketId });
    if (error) return gagal(error);
    if (data === null || data === undefined) return ok(null);
    const obj = (Array.isArray(data) ? data[0] : data) as { jawaban?: unknown; updated_at?: unknown } | null | undefined;
    if (!obj) return ok(null);
    const jawaban = typeof obj.jawaban === 'object' && obj.jawaban !== null && !Array.isArray(obj.jawaban)
      ? (obj.jawaban as Record<string, unknown>)
      : {};
    return ok({ jawaban, updatedAt: typeof obj.updated_at === 'string' ? obj.updated_at : null });
  } catch (e) {
    return gagal(e);
  }
}

/** `pendataan_khusus_draf_simpan`: PENGGANTIAN seluruh objek jawaban (bukan patch). Hanya pemilik tiket yang dilayani. */
export async function simpanDrafKhusus(
  sb: SupabaseClient, tiketId: string, jawaban: Record<string, unknown>,
): Promise<HasilKhusus<{ updatedAt: string | null }>> {
  try {
    const { data, error } = await sb.rpc('pendataan_khusus_draf_simpan', { p_tiket: tiketId, p_jawaban: jawaban });
    if (error) return gagal(error);
    if (data === null || data === undefined) return gagal(new Error('Balasan kosong dari server'));
    const obj = (Array.isArray(data) ? data[0] : data) as { updated_at?: unknown } | null | undefined;
    return ok({ updatedAt: typeof obj?.updated_at === 'string' ? obj.updated_at : null });
  } catch (e) {
    return gagal(e);
  }
}

// ── Selesai ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * `layanan_selesai_khusus`: satu jalur finalisasi bagi tiket tanpa formulir tetap (dengan atau tanpa isian Khusus). Jangan
 * mengirim `p_jawaban`: nama argumen yang berlaku `p_khusus`. Draf dihapus server dalam transaksi yang sama.
 * `jalurLama` (RPC definisi belum ada): `layanan_selesai` seperti sebelum G5; identitas tetap lewat layanan_selesai_khusus.
 */
export async function selesaikanTiketKhusus(
  sb: SupabaseClient, p: ParamSelesaiKhusus, jalurLama = false,
): Promise<HasilKhusus<{ peringatan: string | null }>> {
  try {
    const memakaiKhusus = !jalurLama || p.identitas !== null || (p.khusus !== null && Object.keys(p.khusus).length > 0);
    const { data, error } = memakaiKhusus
      ? await sb.rpc('layanan_selesai_khusus', {
          p_tiket_id: p.tiketId,
          p_topik_id: p.topikId,
          p_catatan: p.catatan,
          p_khusus: p.khusus,
          ...(p.identitas ? { p_identitas: p.identitas } : {}),
        })
      : await sb.rpc('layanan_selesai', {
          p_tiket_id: p.tiketId,
          ...(p.topikId ? { p_topik_id: p.topikId } : {}),
          ...(p.catatan ? { p_catatan: p.catatan } : {}),
        });
    if (error) return gagal(error);
    // Balasan kosong tanpa galat bukan sukses (jangan menampilkan "selesai" bila server tidak mengonfirmasi).
    if (data === null || data === undefined) return gagal(new Error('Balasan kosong dari server'));
    const obj = (Array.isArray(data) ? data[0] : data) as { peringatan?: unknown } | null | undefined;
    return ok({ peringatan: typeof obj?.peringatan === 'string' ? obj.peringatan : null });
  } catch (e) {
    return gagal(e);
  }
}

// ── Langkah 1: Data dari Front Office ────────────────────────────────────────────────────────────────────────

type Embed<T> = T | T[] | null | undefined;
const satu = <T,>(v: Embed<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

interface BarisDataFo {
  id: string;
  penanganan_asal_id: string | null;
  waktu_terbit: string | null;
  kunjungan: Embed<{
    nama: string; kontak_hp: string | null; email: string | null; asal_instansi: string | null; kategori: string | null;
    keperluan: string | null; asal: string | null; waktu_masuk: string | null; pencatat: Embed<{ nama: string }>;
  }>;
}

/**
 * Identitas kunjungan, keperluan/catatan eskalasi FO, nama pencatat, dan jam daftar untuk satu tiket (baca-saja).
 * Catatan eskalasi hanya pelengkap: galatnya tidak menggagalkan langkah (dijadikan kosong).
 */
export async function muatDataDariFo(sb: SupabaseClient, tiketId: string): Promise<HasilKhusus<DataDariFo | null>> {
  try {
    const { data, error } = await sb.from('tiket_antrean').select(KOLOM_TIKET_DATA_FO).eq('id', tiketId).maybeSingle();
    if (error) return gagal(error);
    if (!data) return ok(null);
    const baris = data as unknown as BarisDataFo;
    const k = satu(baris.kunjungan);
    let eskalasi: CatatanEskalasi | null = null;
    if (baris.penanganan_asal_id) {
      const hasil = await muatCatatanEskalasi(sb, [baris.penanganan_asal_id]);
      eskalasi = hasil.data?.[baris.penanganan_asal_id] ?? null;
    }
    return ok({
      nama: k?.nama ?? '',
      kontakHp: k?.kontak_hp ?? null,
      email: k?.email ?? null,
      asalInstansi: k?.asal_instansi ?? null,
      kategori: k?.kategori ?? null,
      keperluan: k?.keperluan ?? null,
      asal: k?.asal ?? null,
      waktuDaftar: k?.waktu_masuk ?? baris.waktu_terbit ?? null,
      pencatatNama: satu(k?.pencatat)?.nama ?? eskalasi?.foNama ?? null,
      eskalasi,
      hasilEskalasi: Boolean(baris.penanganan_asal_id),
    });
  } catch (e) {
    return gagal(e);
  }
}
