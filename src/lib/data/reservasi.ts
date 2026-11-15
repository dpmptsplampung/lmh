// Lapisan data reservasi pengunjung (rencana refaktor 2026-11-11 tugas 9.1, SPEC bagian 7): kueri `kunjungan` milik
// sendiri, `pengunjung`, `v_layanan_publik`, `v_antrian_loket`, `hari_libur`, RPC jadwal, `consent_log`, dan pembungkus RPC
// `reservasi_buat`/`reservasi_batalkan` yang sebelumnya hidup di `app/me/reservasi/page.tsx`.
//
// Aturan lapisan data (sama dengan lib/data/antrean.ts):
// - Fungsi menerima SupabaseClient sebagai argumen pertama (klien browser dengan RLS pengguna), tanpa React dan tanpa toast.
//   Pemanggil yang memutuskan cara menampilkan galat.
// - Tidak pernah melempar: hasilnya HasilReservasi<T> = { data, error: null } | { data: null, error: GalatReservasi }.
//   `error.asli` membawa objek galat aslinya agar pemanggil dapat mencatat/memilah.
// - `select` selalu daftar kolom eksplisit lewat konstanta KOLOM_*.
import type { SupabaseClient } from '@supabase/supabase-js';
import { mutasiInsert } from '@/lib/supabase/mutate';
import { GalatRpc } from '@/lib/rpc-galat';
import {
  KOLOM_RESERVASI,
  panggilReservasiBatalkan,
  panggilReservasiBuat,
  pesanGalatReservasiBatal,
  pesanGalatReservasiBuat,
  type HasilReservasiBuat,
  type InputReservasi,
  type ReservasiKunjungan,
} from '@/lib/reservasi';

// ---------------------------------------------------------------------------------------------------------------
// Kolom, batas, konstanta
// ---------------------------------------------------------------------------------------------------------------

export const KOLOM_PENGUNJUNG_RESERVASI = 'id, nama';
export const KOLOM_LAYANAN_RESERVASI = 'id, nama, status_tampilan, punya_antrean';
export const KOLOM_ANTREAN_LOKET = 'antre_count, estimasi_tunggu_total_menit';
export const KOLOM_HARI_LIBUR_RESERVASI = 'tanggal';
/** Jumlah reservasi terbaru yang dimuat ke daftar "Reservasi Saya". */
export const BATAS_DAFTAR_RESERVASI = 30;
/** Versi teks persetujuan PDP yang dicatat ke `consent_log` (teks yang tampil ada di FormReservasi). */
export const VERSI_KEBIJAKAN_RESERVASI = '1.0';

// ---------------------------------------------------------------------------------------------------------------
// Tipe
// ---------------------------------------------------------------------------------------------------------------

export interface GalatReservasi {
  /** Pesan siap tampil (hanya terisi untuk buat/batal; selainnya pemanggil memakai pesannya sendiri). */
  pesan: string;
  /** Kode kontrak RPC (mis. RESERVASI_GANDA) bila galat berasal dari GalatRpc; selain itu null. */
  kode: string | null;
  /** Objek galat aslinya, untuk log. */
  asli: unknown;
}

export type HasilReservasiData<T> = { data: T; error: null } | { data: null; error: GalatReservasi };

export interface PengunjungReservasi {
  authUserId: string | null;
  /** `pengunjung.id` milik pengguna ini; null bila belum login atau profil pengunjung belum ada. */
  pengunjungId: string | null;
}

export interface LayananReservasi {
  id: string;
  nama: string;
  status_tampilan?: string;
  punya_antrean?: boolean;
}

export interface EstimasiAntreanLoket {
  antre_count: number;
  estimasi_tunggu_total_menit: number;
}

const ok = <T>(data: T): HasilReservasiData<T> => ({ data, error: null });
const gagal = <T>(e: unknown, pesan = ''): HasilReservasiData<T> => ({
  data: null,
  error: { pesan, kode: e instanceof GalatRpc ? e.kode : null, asli: e },
});

// ---------------------------------------------------------------------------------------------------------------
// Bacaan
// ---------------------------------------------------------------------------------------------------------------

/** Pengguna masuk + id `pengunjung`-nya. Galat apa pun = belum ada profil (formulir tetap tampil, kirim ditolak oleh validasi). */
export async function muatPengunjungReservasi(sb: SupabaseClient): Promise<HasilReservasiData<PengunjungReservasi>> {
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return ok({ authUserId: null, pengunjungId: null });
    const { data: pengunjung } = await sb
      .from('pengunjung')
      .select(KOLOM_PENGUNJUNG_RESERVASI)
      .eq('auth_user_id', user.id)
      .single();
    return ok({ authUserId: user.id, pengunjungId: pengunjung ? (pengunjung.id as string) : null });
  } catch (e) {
    return gagal(e);
  }
}

/**
 * Reservasi milik pengunjung (§6.6). Filter pengunjung_id eksplisit: staf yang membuka halaman ini lolos RLS baca semua
 * `kunjungan`, jadi jangan bergantung pada RLS saja.
 */
export async function muatReservasiSaya(
  sb: SupabaseClient,
  idPengunjung: string,
): Promise<HasilReservasiData<ReservasiKunjungan[]>> {
  try {
    const { data, error } = await sb
      .from('kunjungan')
      .select(KOLOM_RESERVASI)
      .eq('pengunjung_id', idPengunjung)
      .eq('asal', 'reservasi')
      .order('tanggal', { ascending: false })
      .limit(BATAS_DAFTAR_RESERVASI);
    if (error) throw error;
    return ok((data ?? []) as unknown as ReservasiKunjungan[]);
  } catch (e) {
    return gagal(e);
  }
}

/** Layanan yang dapat direservasi: bukan modul publik dan tidak ditandai tanpa antrean. */
export async function muatLayananReservasi(sb: SupabaseClient): Promise<HasilReservasiData<LayananReservasi[]>> {
  try {
    const { data, error } = await sb
      .from('v_layanan_publik')
      .select(KOLOM_LAYANAN_RESERVASI)
      .neq('tipe', 'modul_publik')
      .order('nama');
    if (error) throw error;
    return ok(((data || []) as LayananReservasi[]).filter((l) => l.punya_antrean !== false));
  } catch (e) {
    return gagal(e);
  }
}

/** Antrean HARI INI satu layanan (v_antrian_loket); null bila belum ada baris. */
export async function muatEstimasiAntrean(
  sb: SupabaseClient,
  layananId: string,
): Promise<HasilReservasiData<EstimasiAntreanLoket | null>> {
  try {
    const { data, error } = await sb
      .from('v_antrian_loket')
      .select(KOLOM_ANTREAN_LOKET)
      .eq('layanan_id', layananId)
      .maybeSingle();
    if (error) throw error;
    return ok((data as EstimasiAntreanLoket | null) ?? null);
  } catch (e) {
    return gagal(e);
  }
}

/** true = tanggal tercatat sebagai hari libur. Galat baca = "tidak diketahui" (pemanggil tidak menolak; DB yang memvalidasi). */
export async function cekHariLibur(sb: SupabaseClient, tanggal: string): Promise<HasilReservasiData<boolean>> {
  try {
    const { data, error } = await sb
      .from('hari_libur')
      .select(KOLOM_HARI_LIBUR_RESERVASI)
      .eq('tanggal', tanggal)
      .maybeSingle();
    if (error) throw error;
    return ok(!!data);
  } catch (e) {
    return gagal(e);
  }
}

/** Hasil RPC `is_layanan_buka_jadwal`: true/false, atau null bila server tidak memberi jawaban boolean. */
export async function cekLayananBuka(
  sb: SupabaseClient,
  layananId: string,
  tanggal: string,
): Promise<HasilReservasiData<boolean | null>> {
  try {
    const { data, error } = await sb.rpc('is_layanan_buka_jadwal', {
      p_layanan_id: layananId,
      p_tanggal: tanggal,
      p_jam: null,
    });
    if (error) throw error;
    return ok(typeof data === 'boolean' ? data : null);
  } catch (e) {
    return gagal(e);
  }
}

/** Tanggal (YYYY-MM-DD) jadwal terdekat sesudah `dariTanggal` menurut RPC `jadwal_berikutnya`; null bila tidak ada. */
export async function muatJadwalBerikutnya(
  sb: SupabaseClient,
  layananId: string,
  dariTanggal: string,
): Promise<HasilReservasiData<string | null>> {
  try {
    const { data, error } = await sb.rpc('jadwal_berikutnya', {
      p_layanan_id: layananId,
      p_dari_tanggal: dariTanggal,
    });
    if (error) throw error;
    return ok(typeof data === 'string' && data ? data : null);
  } catch (e) {
    return gagal(e);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Tulisan
// ---------------------------------------------------------------------------------------------------------------

/**
 * Catat persetujuan PDP sebelum memanggil `reservasi_buat`. Hasilnya WAJIB diperiksa (supabase-js tidak melempar,
 * kegagalan kembali sebagai { error }): gagal -> reservasi TIDAK dilanjutkan (audit S1, K11).
 */
export async function catatPersetujuanReservasi(sb: SupabaseClient, authUserId: string): Promise<HasilReservasiData<true>> {
  try {
    await mutasiInsert(
      sb.from('consent_log').insert({
        subjek_ref: authUserId,
        tujuan: 'reservasi_data',
        disetujui: true,
        versi_kebijakan: VERSI_KEBIJAKAN_RESERVASI,
      }),
    );
    return ok(true);
  } catch (e) {
    return gagal(e);
  }
}

/** RPC `reservasi_buat`. Server memvalidasi ulang tanggal/jadwal/kuota; `error.pesan` siap tampil. */
export async function buatReservasi(sb: SupabaseClient, input: InputReservasi): Promise<HasilReservasiData<HasilReservasiBuat>> {
  try {
    return ok(await panggilReservasiBuat(sb, input));
  } catch (e) {
    return gagal(e, pesanGalatReservasiBuat(e));
  }
}

/** RPC `reservasi_batalkan`; `error.pesan` siap tampil. */
export async function batalkanReservasi(sb: SupabaseClient, kunjunganId: string): Promise<HasilReservasiData<true>> {
  try {
    await panggilReservasiBatalkan(sb, kunjunganId);
    return ok(true);
  } catch (e) {
    return gagal(e, pesanGalatReservasiBatal(e));
  }
}
