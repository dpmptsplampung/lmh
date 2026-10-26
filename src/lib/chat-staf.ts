// Live chat sebagai layanan online tercatat (Tahap C): kontrak klien untuk aksi staf atas sesi chat.
// Kontrak DB yang mengikat: docs/analysis/FO-CHAT-KONTRAK-RPC.md (§2 RPC chat_ambil/chat_teruskan/chat_selesai,
// §5 perubahan klien). Aturan umum sama dengan kontrak FO (kode galat di AWAL pesan, balasan jsonb `ok: true`).
//
// Modul ini MURNI (tanpa React/supabase) sehingga dipakai route handler `/api/chat/sesi` (menerjemahkan galat RPC ke
// status HTTP + pesan) dan halaman admin chat (memetakan jawaban route ke pesan inline) dengan satu sumber kebenaran.
import {
  BATAS_CATATAN_FO,
  MAKS_ALASAN_TOLAK,
  MIN_ALASAN_TOLAK,
} from '@/lib/fo-penanganan';
import { kodeDariPesan } from '@/lib/rpc-galat';
import { MAX_CATATAN_LAYANAN } from '@/lib/pelayanan';

// ---------------------------------------------------------------------------
// Batas & tipe
// ---------------------------------------------------------------------------

export const BATAS_CATATAN_CHAT_FO = BATAS_CATATAN_FO; // 200 (tahap FO)
export const BATAS_CATATAN_CHAT_LAYANAN = MAX_CATATAN_LAYANAN; // 1000 (tahap layanan)
/** Alasan Admin mengambil alih chat yang sedang dipegang staf lain: 5..500 karakter. */
export const MIN_ALASAN_AMBIL_ALIH_CHAT = MIN_ALASAN_TOLAK;
export const MAKS_ALASAN_AMBIL_ALIH_CHAT = MAKS_ALASAN_TOLAK;

/** Penanda pesan penutup yang ditulis `chat_selesai` (tempat tautan survei; tanpa URL, diisi Tahap E). */
export const JENIS_PENUTUP_SURVEI = 'penutup_survei';

export type PeranTahapChat = 'fo' | 'layanan';

export interface HasilChatAmbil {
  ok: true;
  sudah_milik_anda: boolean;
  ambil_alih: boolean;
  sesi_id: string;
  kunjungan_id: string;
  penanganan_id: string;
  peran_tahap: PeranTahapChat;
  mulai_at: string;
  pemilik_lama?: string | null;
}

export interface HasilChatTeruskan {
  ok: true;
  sesi_id: string;
  kunjungan_id: string;
  penanganan_fo_id: string;
  penanganan_layanan_id: string;
  layanan_id: string;
  layanan_nama: string;
  /** false = belum ada petugas layanan tujuan yang absen hadir hari ini (BUKAN galat; peringatkan FO). */
  petugas_hadir: boolean;
  notifikasi_diantrekan: number;
}

export interface HasilChatSelesai {
  ok: true;
  sesi_id: string;
  kunjungan_id: string;
  penanganan_id: string;
  kunjungan_status: string;
  selesai_at: string;
  pesan_penutup_id: string | null;
}

/** Badan permintaan `POST /api/chat/sesi` (union terdiskriminasi menurut `aksi`). */
export type AksiChat =
  | { sesi_id: string; aksi: 'takeover'; alasan?: string }
  | { sesi_id: string; aksi: 'teruskan'; layanan_id: string; topik_id: string; catatan: string }
  | {
      sesi_id: string;
      aksi: 'selesaikan';
      topik_id: string;
      catatan: string;
      /** Fase 4: jawaban Pendataan Khusus { id isian: nilai } (hanya tahap layanan). */
      khusus?: Record<string, unknown>;
      /** Fase 4: identitas pengunjung yang dilengkapi/dikoreksi petugas (kosong = tidak diubah). */
      identitas?: Partial<Record<'nama' | 'kontak_hp' | 'email' | 'asal_instansi' | 'kategori' | 'keperluan', string>>;
    };

// ---------------------------------------------------------------------------
// Pemetaan galat
// ---------------------------------------------------------------------------

export type KodeGalatChat =
  | 'FORBIDDEN'
  | 'SESI_TIDAK_SAH'
  | 'NOT_FOUND'
  | 'INVALID_STATUS'
  | 'SUDAH_DIAMBIL'
  | 'ALASAN_WAJIB'
  | 'DIVERGENSI'
  | 'BUKAN_TAHAP_FO'
  | 'BUKAN_PEMILIK'
  | 'TOPIK_WAJIB'
  | 'TOPIK_TIDAK_VALID'
  | 'CATATAN_WAJIB'
  | 'CATATAN_TERLALU_PANJANG'
  | 'LAYANAN_TIDAK_VALID'
  | 'CHAT_HARUS_RPC'
  | 'HARI_TANPA_LAYANAN'
  | 'AKSI_TIDAK_DIDUKUNG';

/** Pesan siap tampil (Indonesia, tanpa detail teknis) per kode galat RPC chat. */
export const PESAN_GALAT_CHAT: Record<KodeGalatChat, string> = {
  FORBIDDEN: 'Anda tidak berwenang atas chat ini (bukan layanan Anda, atau chat sudah diteruskan ke layanan lain).',
  SESI_TIDAK_SAH:
    'Sesi Anda sudah tidak berlaku (masuk di perangkat lain atau terlalu lama tidak aktif). Silakan masuk kembali.',
  NOT_FOUND: 'Sesi chat tidak ditemukan. Daftar dimuat ulang.',
  INVALID_STATUS:
    'Status chat sudah berubah (sudah selesai, atau belum diambil). Daftar dimuat ulang.',
  SUDAH_DIAMBIL: 'Chat ini baru saja diambil staf lain. Daftar dimuat ulang.',
  ALASAN_WAJIB: `Alasan ambil alih wajib diisi (${MIN_ALASAN_AMBIL_ALIH_CHAT}-${MAKS_ALASAN_AMBIL_ALIH_CHAT} karakter).`,
  DIVERGENSI: 'Data chat tidak konsisten (tidak ada tahap yang sedang berjalan). Mohon laporkan ke Admin.',
  BUKAN_TAHAP_FO: 'Chat ini sedang ditangani petugas layanan, sehingga tidak dapat diteruskan dari Front Office.',
  BUKAN_PEMILIK: 'Chat ini dipegang staf lain. Hanya yang mengambilnya yang dapat meneruskan atau menyelesaikannya.',
  TOPIK_WAJIB: 'Topik wajib dipilih.',
  TOPIK_TIDAK_VALID: 'Topik yang dipilih tidak berlaku (mungkin sudah dinonaktifkan). Pilih topik lain.',
  CATATAN_WAJIB: 'Catatan wajib diisi.',
  CATATAN_TERLALU_PANJANG: 'Catatan terlalu panjang. Persingkat catatan Anda.',
  LAYANAN_TIDAK_VALID: 'Layanan tujuan tidak dapat dipakai (tidak aktif atau tidak melayani chat). Pilih layanan lain.',
  CHAT_HARUS_RPC: 'Perubahan chat ditolak oleh sistem. Muat ulang halaman lalu coba lagi.',
  HARI_TANPA_LAYANAN:
    'Hari ini hari tanpa pelayanan (Sabtu/Minggu/hari libur): chat tidak dapat diambil atau diteruskan. Pengunjung dilayani bot; chat yang menunggu ditutup otomatis setelah 24 jam tanpa aktivitas.',
  AKSI_TIDAK_DIDUKUNG: 'Aksi ini tidak lagi didukung.',
};

const KODE_SET: ReadonlySet<string> = new Set(Object.keys(PESAN_GALAT_CHAT));

/** Kode galat kontrak chat dari pesan/objek galat apa pun; null bila tidak dikenal. */
export function kodeGalatChat(e: unknown): KodeGalatChat | null {
  let pesan: string | null = null;
  if (typeof e === 'string') pesan = e;
  else if (typeof e === 'object' && e !== null) {
    // GalatRpc/MutasiError menyimpan galat PostgREST asli di `asal`; objek `{ message }` dipakai apa adanya.
    const asal = (e as { asal?: unknown }).asal;
    const sumber = typeof asal === 'object' && asal !== null ? asal : e;
    const m = (sumber as { message?: unknown }).message;
    pesan = typeof m === 'string' ? m : null;
    const kode = (e as { kode?: unknown }).kode;
    if (typeof kode === 'string' && KODE_SET.has(kode)) return kode as KodeGalatChat;
  }
  const kode = kodeDariPesan(pesan);
  return kode && KODE_SET.has(kode) ? (kode as KodeGalatChat) : null;
}

export function pesanGalatChat(kode: string | null | undefined, fallback = 'Terjadi kesalahan, coba lagi.'): string {
  return kode && KODE_SET.has(kode) ? PESAN_GALAT_CHAT[kode as KodeGalatChat] : fallback;
}

/** Galat yang berarti tampilan klien basi -> muat ulang daftar. */
const KODE_MUAT_ULANG: ReadonlySet<string> = new Set([
  'NOT_FOUND', 'SUDAH_DIAMBIL', 'INVALID_STATUS', 'BUKAN_PEMILIK', 'BUKAN_TAHAP_FO', 'DIVERGENSI',
]);
export function kodeChatPerluMuatUlang(kode: string | null | undefined): boolean {
  return !!kode && KODE_MUAT_ULANG.has(kode);
}

/** Status HTTP route untuk kode galat RPC chat. */
export function statusHttpGalatChat(kode: KodeGalatChat | null): number {
  switch (kode) {
    case 'SESI_TIDAK_SAH': return 401;
    case 'FORBIDDEN':
    case 'BUKAN_PEMILIK':
    case 'CHAT_HARUS_RPC': return 403;
    case 'NOT_FOUND': return 404;
    case 'INVALID_STATUS':
    case 'SUDAH_DIAMBIL':
    case 'BUKAN_TAHAP_FO':
    case 'HARI_TANPA_LAYANAN': return 409;
    case 'ALASAN_WAJIB':
    case 'TOPIK_WAJIB':
    case 'TOPIK_TIDAK_VALID':
    case 'CATATAN_WAJIB':
    case 'CATATAN_TERLALU_PANJANG':
    case 'LAYANAN_TIDAK_VALID': return 422;
    case 'AKSI_TIDAK_DIDUKUNG': return 410;
    default: return 500; // DIVERGENSI dan kode tak dikenal
  }
}

// ---------------------------------------------------------------------------
// Validasi isian (cermin aturan DB agar pesan muncul sebelum request; DB tetap penegak)
// ---------------------------------------------------------------------------

export function batasCatatanChat(peran: PeranTahapChat): number {
  return peran === 'fo' ? BATAS_CATATAN_CHAT_FO : BATAS_CATATAN_CHAT_LAYANAN;
}

export function validasiTopikCatatanChat(topikId: string, catatan: string, peran: PeranTahapChat): string | null {
  if (!topikId) return PESAN_GALAT_CHAT.TOPIK_WAJIB;
  const bersih = catatan.trim();
  if (bersih.length === 0) return PESAN_GALAT_CHAT.CATATAN_WAJIB;
  if (bersih.length > batasCatatanChat(peran)) {
    return `Catatan terlalu panjang (maksimal ${batasCatatanChat(peran)} karakter).`;
  }
  return null;
}

export function validasiAlasanAmbilAlih(alasan: string): string | null {
  const n = alasan.trim().length;
  return n < MIN_ALASAN_AMBIL_ALIH_CHAT || n > MAKS_ALASAN_AMBIL_ALIH_CHAT ? PESAN_GALAT_CHAT.ALASAN_WAJIB : null;
}

// ---------------------------------------------------------------------------
// Pemanggil route (sisi klien)
// ---------------------------------------------------------------------------

/** Galat aksi chat dari route: `kode` (kontrak) bila dikenal, `pesan` siap tampil. */
export class GalatAksiChat extends Error {
  readonly kode: KodeGalatChat | null;
  readonly status: number;
  /** Pesan Indonesia siap tampil (sama dengan message). */
  readonly pesan: string;
  /** Kode mentah dari badan galat (mis. KHUSUS_TIDAK_VALID, MIGRASI_BELUM_DITERAPKAN) walau bukan kode kontrak chat. */
  readonly kodeMentah: string | null;
  constructor(kode: KodeGalatChat | null, pesan: string, status: number, kodeMentah: string | null = null) {
    super(pesan);
    this.name = 'GalatAksiChat';
    this.pesan = pesan;
    this.kode = kode;
    this.status = status;
    this.kodeMentah = kodeMentah;
  }
}

/**
 * Memanggil `POST /api/chat/sesi`. Melempar `GalatAksiChat` (pesan Indonesia, kode kontrak) bila gagal;
 * mengembalikan balasan RPC (`data`) bila sukses.
 */
export async function kirimAksiChat<T = Record<string, unknown>>(aksi: AksiChat): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api/chat/sesi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(aksi),
    });
  } catch {
    throw new GalatAksiChat(null, 'Koneksi bermasalah, periksa jaringan Anda lalu coba lagi', 0);
  }
  const body = (await res.json().catch(() => ({}))) as { error?: unknown; kode?: unknown; data?: unknown };
  if (!res.ok) {
    const kode = typeof body.kode === 'string' && KODE_SET.has(body.kode) ? (body.kode as KodeGalatChat) : null;
    const pesan = kode
      ? PESAN_GALAT_CHAT[kode]
      : typeof body.error === 'string' && body.error
        ? body.error
        : 'Terjadi kesalahan, coba lagi.';
    throw new GalatAksiChat(kode, pesan, res.status, typeof body.kode === 'string' ? body.kode : null);
  }
  return (body.data ?? body) as T;
}
