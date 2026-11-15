// Lapisan data chat pengunjung (rencana refaktor 2026-11-11 tugas 6.2, SPEC bagian 5): kueri dan RPC yang sebelumnya hidup
// di `app/chat/page.tsx` (`pengunjung`, `v_layanan_publik`, `faq_knowledge_base`, `chat_sesi`, `consent_log`, RPC
// `chat_percakapan_saya`) dan pembungkus `fetch` ke route /api/chat/{ai,messages,status,petugas}.
//
// Aturan lapisan data:
// - Fungsi Supabase menerima SupabaseClient sebagai argumen pertama (klien browser dengan RLS pengguna); tanpa React dan
//   tanpa toast. Pemanggil yang memutuskan cara menampilkan galat.
// - Tidak pernah melempar: hasilnya HasilChat<T> = { data, error: null } | { data: null, error: GalatChat }.
//   `error.asli` membawa galat aslinya (MutasiError / galat PostgREST / Error) untuk log dan pemilahan pesan.
// - `select` selalu daftar kolom eksplisit lewat konstanta KOLOM_*.
// - Pembungkus fetch dibatalkan setelah BATAS_WAKTU_CHAT_MS (65 dtk; route AI berbatas maxDuration 60 dtk).
// Route /api/chat/sesi tidak dipanggil halaman pengunjung (sesi dibuat lewat insert `chat_sesi` di bawah RLS), jadi tidak
// dibungkus di sini.
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { ChatMsg } from '@/app/chat/merge';
import { dariBarisRpc, dariBarisSesi, type BarisSesi, type PercakapanRingkas } from '@/lib/chat/percakapan';
import type { LampiranChat } from '@/lib/chat/lampiran';
import type { StatusLayananChat } from '@/lib/chat/status-layanan';
import { MutasiError, mutasiInsert, type KodeMutasi } from '@/lib/supabase/mutate';

// ---------------------------------------------------------------------------------------------------------------
// Kolom, batas, dan pola
// ---------------------------------------------------------------------------------------------------------------

export const KOLOM_PENGUNJUNG_CHAT = 'id, nama';
export const KOLOM_LAYANAN_CHAT = 'id, nama, chatbot_aktif, status_tampilan, punya_chat';
export const KOLOM_FAQ_CHAT = 'id, pertanyaan, jawaban, layanan_id, urutan';
/** Cadangan daftar percakapan (RPC belum ada): sesi milik pengunjung. */
export const KOLOM_SESI_DAFTAR = 'id, layanan_id, status, created_at';
/** Sesi yang baru dibuat: hanya id dan status yang dipakai halaman. */
export const KOLOM_SESI_BARU = 'id, status';

/** Batas waktu setiap permintaan ke /api/chat/*; route AI berbatas maxDuration 60 dtk. */
export const BATAS_WAKTU_CHAT_MS = 65_000;

// id layanan dimasukkan ke string filter PostgREST (`.or(...)`), jadi HARUS berbentuk UUID: nilai dari URL bisa dirusak
// pengguna (mis. "x),aktif.eq.false,(y") dan melebarkan filter.
const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const adalahUuid = (nilai: string): boolean => POLA_UUID.test(nilai);

// ---------------------------------------------------------------------------------------------------------------
// Tipe
// ---------------------------------------------------------------------------------------------------------------

export type StatusSesiChat = 'bot' | 'eskalasi' | 'aktif' | 'selesai';

export interface LayananChat {
  id: string;
  nama: string;
  chatbot_aktif: boolean;
  status_tampilan?: string;
  punya_chat?: boolean;
}

export interface FaqChat {
  id: string;
  pertanyaan: string;
  jawaban: string;
  /** NULL = FAQ umum (berlaku untuk semua layanan). */
  layanan_id: string | null;
  urutan: number | null;
}

export interface ProfilPengunjung {
  id: string;
  nama: string | null;
}

export interface SesiBaru {
  id: string;
  status: StatusSesiChat;
}

/** Baris `consent_log` persetujuan PDP chat (subjek_ref = baris pengunjung milik user atau auth.uid, bukan 'anon'). */
export interface BarisPersetujuan {
  subjek_ref: string;
  tujuan: string;
  disetujui: true;
  versi_kebijakan: string;
}

export type JenisGalatChat = KodeMutasi | 'http' | 'waktu_habis' | 'tidak_valid';

export interface GalatChat {
  jenis: JenisGalatChat;
  /** Pesan siap tampil bila pemanggil tidak punya pesan sendiri. */
  pesan: string;
  /** Galat aslinya (MutasiError, galat PostgREST, Error, atau { status, json } untuk balasan HTTP gagal). */
  asli: unknown;
}

export type HasilChat<T> = { data: T; error: null } | { data: null; error: GalatChat };

// ---------------------------------------------------------------------------------------------------------------
// Galat
// ---------------------------------------------------------------------------------------------------------------

const PESAN_UMUM = 'Terjadi kesalahan. Silakan coba lagi.';
const PESAN_WAKTU_HABIS = 'Waktu tunggu habis. Silakan coba lagi.';

const ok = <T>(data: T): HasilChat<T> => ({ data, error: null });
const gagal = <T>(jenis: JenisGalatChat, pesan: string, asli: unknown): HasilChat<T> => ({
  data: null,
  error: { jenis, pesan, asli },
});

function pesanDari(e: unknown, cadangan = PESAN_UMUM): string {
  if (e instanceof Error) return e.message || cadangan;
  if (typeof e === 'object' && e !== null) {
    const pesan = (e as { message?: unknown }).message;
    if (typeof pesan === 'string' && pesan) return pesan;
  }
  return cadangan;
}

/** Galat yang DILEMPAR (MutasiError dari helper mutasi, atau penolakan promise): MutasiError dipertahankan jenisnya. */
function dariPengecualian<T>(e: unknown): HasilChat<T> {
  if (e instanceof MutasiError) return gagal(e.kode, e.pesan, e);
  return gagal('jaringan', pesanDari(e), e);
}

/** Galat `{ error }` dari PostgREST (supabase-js tidak melempar). */
const dariGalatDb = <T>(error: unknown): HasilChat<T> => gagal('database', pesanDari(error), error);

// ---------------------------------------------------------------------------------------------------------------
// Pengguna dan profil pengunjung
// ---------------------------------------------------------------------------------------------------------------

/** Pengguna Auth saat ini; null = belum masuk (atau sesi login sudah hilang). */
export async function ambilPenggunaChat(sb: SupabaseClient): Promise<HasilChat<User | null>> {
  try {
    const { data } = await sb.auth.getUser();
    return ok(data?.user ?? null);
  } catch (e) {
    return dariPengecualian(e);
  }
}

/**
 * Baris `pengunjung` milik user. `.single()` tanpa baris mengembalikan galat PGRST116: galat PostgREST apa pun berarti
 * "belum ada profil" dan pemanggil membuatnya (perilaku lama). Hanya promise yang menolak yang menjadi `error`.
 */
export async function muatProfilPengunjung(sb: SupabaseClient, authUserId: string): Promise<HasilChat<ProfilPengunjung | null>> {
  try {
    const { data } = await sb.from('pengunjung').select(KOLOM_PENGUNJUNG_CHAT).eq('auth_user_id', authUserId).single();
    return ok((data as ProfilPengunjung | null) ?? null);
  } catch (e) {
    return dariPengecualian(e);
  }
}

/** Membuat baris `pengunjung` untuk user ini (policy pengunjung_self_insert: auth_user_id = auth.uid()). */
export async function buatProfilPengunjung(
  sb: SupabaseClient,
  baris: { auth_user_id: string; nama: string; email: string | null; provider: 'google' | 'email' },
): Promise<HasilChat<ProfilPengunjung | null>> {
  try {
    const { data, error } = await sb.from('pengunjung').insert(baris).select(KOLOM_PENGUNJUNG_CHAT).single();
    if (error) return dariGalatDb(error);
    return ok((data as ProfilPengunjung | null) ?? null);
  } catch (e) {
    return dariPengecualian(e);
  }
}

/** Mulai login Google; `redirectTo` = /auth/callback dengan `next` yang membawa konteks ?layanan=. */
export async function mulaiMasukGoogle(sb: SupabaseClient, redirectTo: string): Promise<HasilChat<true>> {
  try {
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    if (error) return dariGalatDb(error);
    return ok(true as const);
  } catch (e) {
    return dariPengecualian(e);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Layanan dan FAQ
// ---------------------------------------------------------------------------------------------------------------

/** Layanan yang melayani chat (bukan modul publik; `punya_chat` false dibuang), urut nama. Tanpa daftar cadangan. */
export async function muatLayananChat(sb: SupabaseClient): Promise<HasilChat<LayananChat[]>> {
  try {
    const { data, error } = await sb
      .from('v_layanan_publik')
      .select(KOLOM_LAYANAN_CHAT)
      .neq('tipe', 'modul_publik')
      .order('nama');
    if (error) return dariGalatDb(error);
    return ok(((data ?? []) as LayananChat[]).filter((l) => l.punya_chat !== false));
  } catch (e) {
    return dariPengecualian(e);
  }
}

/** FAQ aktif Layanan ini + FAQ umum (layanan_id NULL), urut `urutan` dari database. id bukan UUID ditolak sebelum kueri. */
export async function muatFaqChat(sb: SupabaseClient, layananId: string): Promise<HasilChat<FaqChat[]>> {
  if (!adalahUuid(layananId)) return gagal('tidak_valid', 'id layanan bukan UUID', null);
  try {
    const { data, error } = await sb
      .from('faq_knowledge_base')
      .select(KOLOM_FAQ_CHAT)
      .or(`layanan_id.eq.${layananId},layanan_id.is.null`)
      .eq('aktif', true)
      .order('urutan', { ascending: true });
    if (error) return dariGalatDb(error);
    return ok((data ?? []) as FaqChat[]);
  } catch (e) {
    return dariPengecualian(e);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Percakapan dan sesi
// ---------------------------------------------------------------------------------------------------------------

/**
 * Daftar percakapan pengunjung (satu per Layanan). RPC `chat_percakapan_saya` lebih dulu; bila belum ada (migrasi
 * 202610310001 belum diterapkan) atau gagal, sesi milik pengunjung dikelompokkan per Layanan di klien.
 */
export async function muatDaftarPercakapan(
  sb: SupabaseClient,
  p: { pengunjungId: string | null; layanan: ReadonlyArray<Pick<LayananChat, 'id' | 'nama' | 'chatbot_aktif'>> },
): Promise<HasilChat<PercakapanRingkas[]>> {
  if (typeof sb.rpc === 'function') {
    try {
      const { data, error } = await sb.rpc('chat_percakapan_saya');
      if (!error && Array.isArray(data)) return ok(dariBarisRpc(data));
    } catch {
      /* RPC belum ada: cadangan di bawah */
    }
  }
  if (!p.pengunjungId) return ok([]);
  try {
    const { data, error } = await sb
      .from('chat_sesi')
      .select(KOLOM_SESI_DAFTAR)
      .eq('pengunjung_id', p.pengunjungId)
      .order('created_at', { ascending: false });
    if (error) return dariGalatDb(error);
    const nama = Object.fromEntries(p.layanan.map((l) => [l.id, l.nama]));
    const opsi = Object.fromEntries(p.layanan.map((l) => [l.id, { chatbotAktif: l.chatbot_aktif }]));
    return ok(dariBarisSesi((data ?? []) as BarisSesi[], nama, opsi));
  } catch (e) {
    return dariPengecualian(e);
  }
}

/**
 * Mencatat persetujuan PDP ke `consent_log`. Gagal (ditolak RLS, database, jaringan) = `error` dengan jenis MutasiError
 * (`jaringan` dibedakan agar pesan menyebut koneksi); pemanggil TIDAK boleh membuat sesi bila ini gagal (S1/K11).
 */
export async function catatPersetujuan(sb: SupabaseClient, baris: BarisPersetujuan): Promise<HasilChat<true>> {
  try {
    await mutasiInsert(sb.from('consent_log').insert(baris));
    return ok(true as const);
  } catch (e) {
    return dariPengecualian(e);
  }
}

/**
 * Membuat `chat_sesi` baru (satu sesi per kunjungan; percakapan tetap satu per Layanan). K2: `pengunjung_id` disertakan
 * bila diketahui agar RLS chat_sesi_owner_insert menerima baris (pengunjung.auth_user_id = auth.uid()); tanpa baris
 * pengunjung kolom ini tidak dikirim. Galat membawa MutasiError (jaringan/ditolak/database) di `error.asli`.
 */
export async function buatSesiChat(
  sb: SupabaseClient,
  p: { layananId: string; kontak: string; chatbotAktif: boolean; pengunjungId: string | null },
): Promise<HasilChat<SesiBaru>> {
  const baris: { layanan_id: string; kontak_pengunjung: string; status: string; pengunjung_id?: string } = {
    layanan_id: p.layananId,
    kontak_pengunjung: p.kontak,
    status: p.chatbotAktif ? 'bot' : 'eskalasi',
  };
  if (p.pengunjungId) baris.pengunjung_id = p.pengunjungId;
  try {
    const [sesi] = await mutasiInsert<SesiBaru>(sb.from('chat_sesi').insert(baris).select(KOLOM_SESI_BARU).single());
    if (!sesi) return dariPengecualian(new MutasiError('database'));
    return ok(sesi);
  } catch (e) {
    return dariPengecualian(e);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Route /api/chat/* (fetch berbatas waktu)
// ---------------------------------------------------------------------------------------------------------------

interface Balasan {
  ok: boolean;
  status: number;
  /** Isi JSON; null bila badan bukan JSON. */
  json: unknown;
}

type Objek = Record<string, unknown>;
const objek = (v: unknown): Objek | null => (typeof v === 'object' && v !== null ? (v as Objek) : null);
const galatHttp = <T>(b: Balasan, pesan = PESAN_UMUM): HasilChat<T> => gagal('http', pesan, b);
const terus = <T>(h: { error: GalatChat }): HasilChat<T> => ({ data: null, error: h.error });

/**
 * GET (tanpa `kirim`) atau POST JSON ke route chat. Dibatalkan setelah BATAS_WAKTU_CHAT_MS (`waktu_habis`) atau saat
 * `signal` pemanggil dibatalkan (`jaringan`, sama seperti fetch yang dibatalkan). Badan dibaca sebagai JSON (null bila
 * bukan JSON); status HTTP tidak dianggap galat di sini, pembungkus di bawah yang memutuskan.
 */
async function panggilRute(url: string, opsi: { kirim?: unknown; signal?: AbortSignal } = {}): Promise<HasilChat<Balasan>> {
  const ctrl = new AbortController();
  let habis = false;
  const timer = setTimeout(() => {
    habis = true;
    ctrl.abort();
  }, BATAS_WAKTU_CHAT_MS);
  const ikutBatal = () => ctrl.abort();
  if (opsi.signal?.aborted) ctrl.abort();
  else opsi.signal?.addEventListener('abort', ikutBatal);
  try {
    const init: RequestInit = { signal: ctrl.signal };
    if (opsi.kirim !== undefined) {
      init.method = 'POST';
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(opsi.kirim);
    }
    const res = await fetch(url, init);
    const json: unknown = await res.json().catch(() => null);
    return ok({ ok: res.ok, status: res.status, json });
  } catch (e) {
    return habis ? gagal('waktu_habis', PESAN_WAKTU_HABIS, e) : gagal('jaringan', pesanDari(e), e);
  } finally {
    clearTimeout(timer);
    opsi.signal?.removeEventListener('abort', ikutBatal);
  }
}

export interface DataRiwayat {
  messages: ChatMsg[];
  adaLebih: boolean;
  status: StatusSesiChat | null;
}

/** Riwayat lintas sesi sebuah percakapan (`riwayat=1`); `sebelum` = halaman lebih lama dari waktu itu. */
export async function muatRiwayatChat(p: { sesiId: string; sebelum?: string; signal?: AbortSignal }): Promise<HasilChat<DataRiwayat>> {
  const url =
    `/api/chat/messages?sesi_id=${p.sesiId}&riwayat=1` + (p.sebelum ? `&sebelum=${encodeURIComponent(p.sebelum)}` : '');
  const h = await panggilRute(url, { signal: p.signal });
  if (h.error) return terus(h);
  if (!h.data.ok) return galatHttp(h.data);
  const j = objek(h.data.json);
  if (!j) return gagal('tidak_valid', PESAN_UMUM, h.data);
  return ok({
    messages: (j.messages ?? []) as ChatMsg[],
    adaLebih: !!j.ada_lebih,
    status: j.status ? (j.status as StatusSesiChat) : null,
  });
}

export interface DataSinkron {
  messages: ChatMsg[] | null;
  status: StatusSesiChat | null;
}

/** Sinkronisasi pesan sesi berjalan (catch-up Realtime dan polling cadangan). */
export async function sinkronPesanChat(sesiId: string): Promise<HasilChat<DataSinkron>> {
  const h = await panggilRute(`/api/chat/messages?sesi_id=${sesiId}`);
  if (h.error) return terus(h);
  if (!h.data.ok) return galatHttp(h.data);
  const j = objek(h.data.json);
  if (!j) return gagal('tidak_valid', PESAN_UMUM, h.data);
  return ok({
    messages: j.messages ? (j.messages as ChatMsg[]) : null,
    status: j.status ? (j.status as StatusSesiChat) : null,
  });
}

/** Menyimpan pesan pengunjung; `message` = pesan server pengganti pesan optimistic (client_uuid sama). */
export async function kirimPesanChat(p: { sesiId: string; isi: string; clientUuid?: string | null }): Promise<HasilChat<{ message: ChatMsg | null }>> {
  const h = await panggilRute('/api/chat/messages', {
    kirim: { sesi_id: p.sesiId, pengirim: 'pengunjung', isi: p.isi, client_uuid: p.clientUuid },
  });
  if (h.error) return terus(h);
  if (!h.data.ok) return galatHttp(h.data);
  const pesan = objek(h.data.json)?.message;
  return ok({ message: pesan ? (pesan as ChatMsg) : null });
}

/** Menyimpan pesan hanya-lampiran (foto yang sudah diunggah ke R2). Pesan galat dari route dipakai apa adanya. */
export async function kirimLampiranChat(p: {
  sesiId: string;
  lampiran: LampiranChat;
  clientUuid: string;
}): Promise<HasilChat<{ message: ChatMsg | null }>> {
  const h = await panggilRute('/api/chat/messages', {
    kirim: { sesi_id: p.sesiId, isi: '', lampiran: p.lampiran, client_uuid: p.clientUuid },
  });
  if (h.error) return terus(h);
  const j = objek(h.data.json) ?? {};
  if (!h.data.ok) return galatHttp(h.data, String(j.error ?? 'Foto gagal dikirim'));
  return ok({ message: j.message ? (j.message as ChatMsg) : null });
}

export type JawabanBot =
  /** 429: pengunjung bertanya terlalu cepat. */
  | { jenis: 'terlalu_cepat' }
  /** Balasan gagal atau bukan JSON. */
  | { jenis: 'tidak_tersedia' }
  | {
      jenis: 'jawaban';
      /** Balasan bot yang sudah tersimpan di server. */
      pesan: ChatMsg | null;
      /** Niat "minta petugas" di luar jam tanpa pesan server: pemanggil menampilkan teks tunggu. */
      mintaPetugasLuarJam: boolean;
      status: StatusSesiChat | null;
      eskalasi: boolean;
    };

/** Pertanyaan ke asisten virtual (RAG). Batas waktu habis = `error.jenis` 'waktu_habis'. */
export async function tanyaBotChat(p: { pertanyaan: string; layananId: string; sesiId: string }): Promise<HasilChat<JawabanBot>> {
  const h = await panggilRute('/api/chat/ai', {
    kirim: { pertanyaan: p.pertanyaan, layanan_id: p.layananId, sesi_id: p.sesiId },
  });
  if (h.error) return terus(h);
  if (h.data.status === 429) return ok({ jenis: 'terlalu_cepat' });
  const j = objek(h.data.json);
  if (!h.data.ok || !j) return ok({ jenis: 'tidak_tersedia' });
  return ok({
    jenis: 'jawaban',
    pesan: j.pesan ? (j.pesan as ChatMsg) : null,
    mintaPetugasLuarJam: j.reason === 'minta_petugas' && j.buka === false,
    status: j.status ? (j.status as StatusSesiChat) : null,
    eskalasi: j.eskalasi === true,
  });
}

export type HasilMintaPetugas =
  /** 409 MIGRASI_BELUM_DITERAPKAN: pemanggil memakai jalur lama (pertanyaan ke AI yang mengeskalasi). */
  | { jenis: 'migrasi_belum' }
  | { jenis: 'ditolak'; pesan: string | null }
  | { jenis: 'diterima'; pesan: ChatMsg | null; menungguLuarJam: boolean; status: StatusSesiChat | null };

/** "Hubungkan ke Petugas" (RPC chat_minta_petugas lewat route). */
export async function mintaPetugasChat(sesiId: string): Promise<HasilChat<HasilMintaPetugas>> {
  const h = await panggilRute('/api/chat/petugas', { kirim: { sesi_id: sesiId } });
  if (h.error) return terus(h);
  const j = objek(h.data.json) ?? {};
  if (h.data.status === 409 && j.kode === 'MIGRASI_BELUM_DITERAPKAN') return ok({ jenis: 'migrasi_belum' });
  if (!h.data.ok) return ok({ jenis: 'ditolak', pesan: typeof j.error === 'string' ? j.error : null });
  return ok({
    jenis: 'diterima',
    pesan: j.pesan ? (j.pesan as ChatMsg) : null,
    menungguLuarJam: j.buka === false,
    status: j.status ? (j.status as StatusSesiChat) : null,
  });
}

/** Status jadwal petugas chat Layanan (keputusan di DB). null = balasan tanpa status yang sah. */
export async function ambilStatusLayananChat(layananId: string): Promise<HasilChat<StatusLayananChat | null>> {
  const h = await panggilRute(`/api/chat/status?layanan_id=${layananId}`);
  if (h.error) return terus(h);
  if (!h.data.ok) return galatHttp(h.data);
  const status = objek(objek(h.data.json)?.status);
  return ok(status && typeof status.buka === 'boolean' ? (status as unknown as StatusLayananChat) : null);
}
