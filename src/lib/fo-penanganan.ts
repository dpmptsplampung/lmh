// Alur Front Office (Tahap B): kontrak klien untuk RPC FO, pemetaan galat, dan helper tampilan.
// Kontrak DB yang mengikat: docs/analysis/FO-ESKALASI-KONTRAK-RPC.md (§2 RPC FO, §6 bacaan, §0 aturan klien).
//
// Aturan klien (kontrak §0): semua perubahan status lewat RPC, kode galat ada di AWAL pesan galat
// (`KODE: ...`), balasan sukses selalu jsonb dengan `ok: true`, waktu selalu dari server. Setiap RPC
// dibungkus mutasiWajibBaris (src/lib/supabase/mutate.ts) sehingga galat tidak pernah jadi "sukses palsu".
//
// Modul ini sengaja murni (tanpa React) agar bisa dipakai halaman FO, scan QR, dan komponen dialog.
import type { SupabaseClient } from '@supabase/supabase-js';
import { MutasiError, mutasiWajibBaris } from '@/lib/supabase/mutate';
import { todayWIB } from '@/lib/time';

type KlienRpc = Pick<SupabaseClient, 'rpc'>;

// ---------------------------------------------------------------------------
// Batas & tipe
// ---------------------------------------------------------------------------

/** Catatan singkat FO wajib 1..200 karakter (K10, kontrak §2.4). */
export const BATAS_CATATAN_FO = 200;
/** Alasan tolak reservasi 5..500 karakter (kontrak §2.3). */
export const MIN_ALASAN_TOLAK = 5;
export const MAKS_ALASAN_TOLAK = 500;

export type SaluranPenanganan = 'walk_in' | 'qr' | 'chat';

export interface TopikFo {
  id: string;
  nama: string;
  urut: number;
}

export interface LayananTujuan {
  id: string;
  nama: string;
  prefiks_antrean: string | null;
}

export interface HasilAmbilKotakMasuk {
  ok: boolean;
  sudah_milik_anda?: boolean;
  penanganan_id: string;
  kunjungan_id: string;
  mulai_at?: string;
}

export interface HasilSelesaiFo {
  ok: boolean;
  penanganan_id: string;
  kunjungan_id: string;
  kunjungan_status: string;
  selesai_at: string;
}

export interface HasilEskalasi {
  ok: boolean;
  kunjungan_id: string;
  penanganan_fo_id: string;
  penanganan_layanan_id: string;
  tiket_id: string;
  nomor_display: string;
  layanan_id: string;
  layanan_nama: string;
  /** false = belum ada petugas layanan itu yang absen hadir hari ini (BUKAN galat; peringatkan FO). */
  petugas_hadir: boolean;
  notifikasi_diantrekan?: number | boolean;
}

export interface HasilCheckinReservasi {
  ok: boolean;
  kunjungan_id: string;
  penanganan_id: string;
  nama: string;
  tanggal: string;
  tujuan: string | null;
  layanan_saran_id: string | null;
  layanan_saran_nama: string | null;
  nama_yang_ditemui: string | null;
  keperluan: string | null;
  mulai_at: string;
}

export interface HasilTolakReservasi {
  ok: boolean;
  kunjungan_id: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Pemetaan galat (kontrak: kode galat di awal `error.message`)
// ---------------------------------------------------------------------------

export type KodeGalatFo =
  | 'FORBIDDEN'
  | 'SESI_TIDAK_SAH'
  | 'NOT_FOUND'
  | 'SUDAH_DIAMBIL'
  | 'BUKAN_TAHAP_FO'
  | 'SALURAN_CHAT'
  | 'INVALID_STATUS'
  | 'BUKAN_PEMILIK'
  | 'TOPIK_WAJIB'
  | 'TOPIK_TIDAK_VALID'
  | 'CATATAN_WAJIB'
  | 'CATATAN_TERLALU_PANJANG'
  | 'LAYANAN_TIDAK_VALID'
  | 'LAYANAN_TIDAK_BUKA'
  | 'LAYANAN_TUTUP'
  | 'QR_KEDALUWARSA'
  | 'BUKAN_HARI_INI'
  | 'ALASAN_WAJIB';

/** Pesan siap tampil (Indonesia, tanpa detail teknis) per kode galat RPC Front Office. */
export const PESAN_GALAT_FO: Record<KodeGalatFo, string> = {
  FORBIDDEN: 'Anda tidak berwenang melakukan aksi ini.',
  SESI_TIDAK_SAH:
    'Sesi Anda sudah tidak berlaku (masuk di perangkat lain atau terlalu lama tidak aktif). Silakan masuk kembali.',
  NOT_FOUND: 'Data tidak ditemukan. Data dimuat ulang.',
  SUDAH_DIAMBIL: 'Pengunjung ini baru saja diambil oleh Front Office lain. Daftar dimuat ulang.',
  BUKAN_TAHAP_FO: 'Penanganan ini bukan tahap Front Office, sehingga tidak dapat diproses dari halaman ini.',
  SALURAN_CHAT: 'Penanganan lewat chat diselesaikan dari halaman Live Chat, bukan dari sini.',
  INVALID_STATUS: 'Status sudah berubah (mungkin sudah diproses atau diambil petugas lain). Data dimuat ulang.',
  BUKAN_PEMILIK: 'Penanganan ini dipegang Front Office lain. Hanya yang mengambilnya yang dapat menyelesaikannya.',
  TOPIK_WAJIB: 'Topik wajib dipilih.',
  TOPIK_TIDAK_VALID: 'Topik yang dipilih tidak berlaku (mungkin sudah dinonaktifkan). Pilih topik lain.',
  CATATAN_WAJIB: 'Catatan singkat wajib diisi.',
  CATATAN_TERLALU_PANJANG: `Catatan terlalu panjang (maksimal ${BATAS_CATATAN_FO} karakter).`,
  LAYANAN_TIDAK_VALID:
    'Layanan tujuan tidak dapat dipakai (tidak aktif atau tidak memiliki antrean). Pilih layanan lain.',
  LAYANAN_TIDAK_BUKA: 'Layanan tujuan tidak beroperasi hari ini. Pilih layanan lain.',
  LAYANAN_TUTUP: 'Layanan sudah tutup sehingga eskalasi tidak dapat dilakukan lagi hari ini.',
  QR_KEDALUWARSA: 'QR ini sudah hangus: reservasi tidak datang pada jadwalnya atau tanggalnya sudah lewat.',
  BUKAN_HARI_INI: 'Reservasi ini dijadwalkan untuk tanggal lain, bukan hari ini.',
  ALASAN_WAJIB: `Alasan wajib diisi (${MIN_ALASAN_TOLAK}-${MAKS_ALASAN_TOLAK} karakter).`,
};

const DAFTAR_KODE = Object.keys(PESAN_GALAT_FO) as KodeGalatFo[];
const KODE_SET: ReadonlySet<string> = new Set(DAFTAR_KODE);

function pesanMentah(e: unknown): string | null {
  if (typeof e === 'string') return e;
  if (typeof e !== 'object' || e === null) return null;
  // MutasiError menyimpan galat PostgREST asli di `asal`; objek `{ message }` dipakai apa adanya.
  const asal = (e as { asal?: unknown }).asal;
  const sumber = typeof asal === 'object' && asal !== null ? asal : e;
  const pesan = (sumber as { message?: unknown }).message;
  return typeof pesan === 'string' ? pesan : null;
}

/**
 * Kode galat RPC FO dari error apa pun (MutasiError, `{ message }`, string). Kontrak: kode ada di AWAL pesan;
 * bila tidak ketemu di awal (mis. dibungkus prefiks), dicari sebagai kata utuh. Null = bukan galat FO yang dikenal.
 */
export function kodeGalatFo(e: unknown): KodeGalatFo | null {
  const pesan = pesanMentah(e);
  if (!pesan) return null;
  const awal = /^\s*([A-Z][A-Z_]+)\b/.exec(pesan)?.[1];
  if (awal && KODE_SET.has(awal)) return awal as KodeGalatFo;
  for (const kode of DAFTAR_KODE) {
    if (new RegExp(`\\b${kode}\\b`).test(pesan)) return kode;
  }
  return null;
}

/** Galat yang berarti tampilan klien basi -> pemanggil memuat ulang daftar. */
const KODE_MUAT_ULANG: ReadonlySet<KodeGalatFo> = new Set<KodeGalatFo>([
  'NOT_FOUND', 'SUDAH_DIAMBIL', 'INVALID_STATUS', 'BUKAN_PEMILIK', 'BUKAN_TAHAP_FO', 'SALURAN_CHAT',
]);

export function galatPerluMuatUlang(e: unknown): boolean {
  const kode = kodeGalatFo(e);
  return kode !== null && KODE_MUAT_ULANG.has(kode);
}

/** SESI_TIDAK_SAH = arahkan ke login (pola A2, src/lib/sesi-staf.ts). */
export function galatSesiTidakSah(e: unknown): boolean {
  return kodeGalatFo(e) === 'SESI_TIDAK_SAH';
}

/**
 * Pesan siap tampil untuk galat RPC FO. Kode dikenal -> pesan terpetakan; `MutasiError` tanpa kode
 * (jaringan/ditolak/database) -> pesan helper mutasi; selain itu `fallback`.
 */
export function pesanGalatFo(e: unknown, fallback = 'Terjadi kesalahan, coba lagi.'): string {
  const kode = kodeGalatFo(e);
  if (kode) return PESAN_GALAT_FO[kode];
  if (e instanceof MutasiError) return e.pesan;
  return fallback;
}

// ---------------------------------------------------------------------------
// Validasi isian (cermin aturan DB agar pesan muncul sebelum request; DB tetap penegak)
// ---------------------------------------------------------------------------

export function validasiTopikCatatan(topikId: string, catatan: string): string | null {
  if (!topikId) return PESAN_GALAT_FO.TOPIK_WAJIB;
  const bersih = catatan.trim();
  if (bersih.length === 0) return PESAN_GALAT_FO.CATATAN_WAJIB;
  if (bersih.length > BATAS_CATATAN_FO) return PESAN_GALAT_FO.CATATAN_TERLALU_PANJANG;
  return null;
}

// ---------------------------------------------------------------------------
// Pembungkus RPC (tiap pemanggilan melempar MutasiError bila galat / balasan kosong)
// ---------------------------------------------------------------------------

async function panggil<T>(supabase: KlienRpc, nama: string, args: Record<string, unknown>): Promise<T> {
  const [hasil] = await mutasiWajibBaris<T>(supabase.rpc(nama, args));
  return hasil;
}

export function foAmbilDariKotakMasuk(supabase: KlienRpc, penangananId: string) {
  return panggil<HasilAmbilKotakMasuk>(supabase, 'fo_ambil_dari_kotak_masuk', { p_penanganan_id: penangananId });
}

export function foSelesai(supabase: KlienRpc, a: { penangananId: string; topikId: string; catatan: string }) {
  return panggil<HasilSelesaiFo>(supabase, 'fo_selesai', {
    p_penanganan_id: a.penangananId,
    p_topik_id: a.topikId,
    p_catatan: a.catatan.trim(),
  });
}

export function foEskalasi(
  supabase: KlienRpc,
  a: { penangananId: string; layananId: string; topikId: string; catatan: string },
) {
  return panggil<HasilEskalasi>(supabase, 'fo_eskalasi', {
    p_penanganan_id: a.penangananId,
    p_layanan_id: a.layananId,
    p_topik_id: a.topikId,
    p_catatan: a.catatan.trim(),
  });
}

export function foCheckinReservasi(supabase: KlienRpc, qrToken: string) {
  return panggil<HasilCheckinReservasi>(supabase, 'fo_checkin_reservasi', { p_qr_token: qrToken });
}

export function foTolakReservasi(supabase: KlienRpc, a: { qrToken: string; alasan: string }) {
  return panggil<HasilTolakReservasi>(supabase, 'fo_tolak_reservasi', {
    p_qr_token: a.qrToken,
    p_alasan: a.alasan.trim(),
  });
}

// ---------------------------------------------------------------------------
// Helper tampilan
// ---------------------------------------------------------------------------

/** Embed PostgREST bisa berupa objek atau larik satu elemen tergantung kardinalitas FK. */
export function satu<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export function labelSaluran(saluran: string): string {
  switch (saluran) {
    case 'walk_in': return 'Walk-in';
    case 'qr': return 'Reservasi (QR)';
    case 'chat': return 'Chat';
    default: return saluran;
  }
}

/** Awal hari ini menurut WIB (00:00 +07:00) sebagai ISO UTC, untuk filter `mulai_at >= ...` (kontrak §6.2). */
export function awalHariWIBIso(): string {
  // WIB tidak memakai DST (UTC+7 tetap), sehingga offset konstan aman.
  return new Date(`${todayWIB()}T00:00:00+07:00`).toISOString();
}

/** "HH.mm" pada zona WIB, atau "-" bila kosong/tidak valid. */
export function formatJamWIB(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d
    .toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false })
    .replace(':', '.');
}

/** Lama menunggu/berjalan dalam bahasa ringkas ("5 menit", "1 jam 10 menit", "baru saja"). */
export function formatLama(iso: string | null | undefined, sekarang: Date = new Date()): string {
  if (!iso) return '-';
  const mulai = new Date(iso).getTime();
  if (Number.isNaN(mulai)) return '-';
  const menit = Math.max(0, Math.floor((sekarang.getTime() - mulai) / 60000));
  if (menit < 1) return 'baru saja';
  if (menit < 60) return `${menit} menit`;
  const jam = Math.floor(menit / 60);
  const sisa = menit % 60;
  return sisa === 0 ? `${jam} jam` : `${jam} jam ${sisa} menit`;
}
