// Lapisan data live chat sisi staf (rencana refaktor 2026-11-11 tugas 7.1, SPEC bagian 5): kueri dan pembungkus `fetch` yang
// sebelumnya hidup di `app/admin/chat/page.tsx` (RPC `chat_sesi_ringkas`, `penanganan`, `chat_sesi`, `petugas`, `layanan`,
// `topik_penanganan`, dan route /api/chat/{messages,ai/draft}). Aksi staf atas sesi (ambil, teruskan, selesai) tetap lewat
// `kirimAksiChat` di `lib/chat-staf.ts`; lingkup hak akses ditegakkan RLS/RPC/route, bukan di sini.
//
// Aturan lapisan data:
// - Fungsi Supabase menerima SupabaseClient sebagai argumen pertama (klien browser dengan RLS pengguna); tanpa React dan tanpa
//   toast. Pemanggil yang memutuskan cara menampilkan galat.
// - Tidak pernah melempar. Fungsi bentuk halaman memakai HasilChat<T> (galat bertipe, `error.asli` = galat aslinya);
//   tiga daftar referensi (layanan, petugas, topik FO) memakai Hasil<T> milik lib/data/referensi.ts agar dapat dimuat
//   lewat `useReferensi`.
// - `select` selalu daftar kolom eksplisit lewat konstanta KOLOM_*.
// - Permintaan `fetch` ke route chat TANPA batas waktu (perilaku halaman lama dipertahankan; polling menyusul sendiri).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdminRole } from '@/lib/admin-nav';
import type { ChatMsg } from '@/app/chat/merge';
import type { PeranTahapChat } from '@/lib/chat-staf';
import type { TopikFo } from '@/lib/fo-penanganan';
import { unggahLampiranChat } from '@/lib/chat/lampiran-klien';
import { pesanGalatReferensi, type Hasil } from '@/lib/data/referensi';
import type { GalatChat, HasilChat, JenisGalatChat } from '@/lib/data/chat-pengunjung';

// ---------------------------------------------------------------------------------------------------------------
// Kolom dan batas
// ---------------------------------------------------------------------------------------------------------------

/** Profil staf pembuka halaman chat: peran menentukan lingkup tampilan dan siapa yang memegang topik FO. */
export const KOLOM_PROFIL_STAF_CHAT = 'id, role, layanan_id';
/** Tahap penanganan chat yang masih terbuka (kontrak FO-CHAT §4.2/§4.3), satu baris per sesi. */
export const KOLOM_TAHAP_CHAT = 'id, chat_sesi_id, peran_tahap, status, layanan_id, penangan_id';
/** Nama pengunjung tidak ada di RPC ringkas: dibaca satu baris per sesi yang dibuka. */
export const KOLOM_KONTAK_SESI = 'kontak_pengunjung';
export const KOLOM_LAYANAN_CHAT_STAF = 'id, nama, aktif, punya_chat';
export const KOLOM_PETUGAS_NAMA = 'id, nama';
export const KOLOM_TOPIK_FO = 'id, nama, urut';

/** Batas jumlah sesi pada daftar kotak masuk. */
export const BATAS_SESI_DAFTAR = 100;

// ---------------------------------------------------------------------------------------------------------------
// Tipe
// ---------------------------------------------------------------------------------------------------------------

export type StatusSesiStaf = 'bot' | 'eskalasi' | 'aktif' | 'selesai';

/** Baris RPC public.chat_sesi_ringkas (ringkasan per sesi, tanpa memuat pesan). */
export interface RingkasSesi {
  id: string;
  status: StatusSesiStaf;
  layanan_id: string;
  pengunjung_id: string | null;
  ditangani_oleh: string | null;
  created_at: string;
  updated_at: string;
  last_pesan: string | null;
  last_pesan_at: string | null;
  last_pengirim: 'pengunjung' | 'petugas' | 'bot' | null;
  unread: boolean;
}

/** Tahap penanganan chat yang masih terbuka, per sesi. */
export interface TahapChat {
  id: string;
  chat_sesi_id: string;
  peran_tahap: PeranTahapChat;
  status: 'menunggu' | 'berjalan';
  layanan_id: string | null;
  penangan_id: string | null;
}

export type PeranStaf = AdminRole;

export interface ProfilStafChat {
  id: string;
  role: PeranStaf;
  layanan_id: string | null;
}

/** Layanan untuk nama dan tujuan teruskan (hanya yang aktif dan punya_chat). */
export interface LayananChatStaf {
  id: string;
  nama: string;
  aktif: boolean | null;
  punya_chat: boolean | null;
}

export interface PetugasNama {
  id: string;
  nama: string;
}

export interface DaftarSesiStaf {
  sesi: RingkasSesi[];
  /** null = tahap penanganan gagal dimuat (sesi tetap tampil; pemanggil menandai galat penanganan). */
  tahap: TahapChat[] | null;
}

export interface DataPesanSesi {
  /** null = badan balasan tidak memuat `messages`. */
  messages: ChatMsg[] | null;
  adaLebih: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// Galat
// ---------------------------------------------------------------------------------------------------------------

const ok = <T>(data: T): HasilChat<T> => ({ data, error: null });
const gagal = <T>(jenis: JenisGalatChat, pesan: string, asli: unknown): HasilChat<T> => ({
  data: null,
  error: { jenis, pesan, asli } satisfies GalatChat,
});

function pesanDari(e: unknown, cadangan: string): string {
  if (e instanceof Error) return e.message || cadangan;
  if (typeof e === 'object' && e !== null) {
    const pesan = (e as { message?: unknown }).message;
    if (typeof pesan === 'string' && pesan) return pesan;
  }
  return cadangan;
}

const dariPengecualian = <T>(e: unknown, cadangan: string): HasilChat<T> => gagal('jaringan', pesanDari(e, cadangan), e);
const dariGalatDb = <T>(error: unknown, cadangan: string): HasilChat<T> => gagal('database', pesanDari(error, cadangan), error);

// ---------------------------------------------------------------------------------------------------------------
// Profil dan daftar sesi
// ---------------------------------------------------------------------------------------------------------------

/**
 * Profil petugas pengguna saat ini. `data: null` = belum masuk atau tidak punya baris petugas (halaman tetap tampil;
 * RLS/RPC yang menolak). Galat PostgREST pada baris petugas diperlakukan sama seperti perilaku lama (dianggap tidak ada);
 * hanya penolakan promise (jaringan) yang menjadi `error`.
 */
export async function muatProfilStafChat(sb: SupabaseClient): Promise<HasilChat<ProfilStafChat | null>> {
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return ok(null);
    const { data } = await sb.from('petugas').select(KOLOM_PROFIL_STAF_CHAT).eq('auth_user_id', user.id).maybeSingle();
    return ok((data as ProfilStafChat | null) ?? null);
  } catch (e) {
    return dariPengecualian(e, 'Gagal memuat profil petugas.');
  }
}

/**
 * Daftar sesi + tahap penanganan yang masih terbuka, dimuat bersamaan (lewat RLS). Galat RPC = `database` (daftar tidak
 * dapat ditampilkan); galat tahap TIDAK menggagalkan daftar (`tahap: null`); penolakan promise mana pun = `jaringan`.
 */
export async function muatDaftarSesiStaf(
  sb: SupabaseClient,
  opsi: { sertakanSelesai: boolean },
): Promise<HasilChat<DaftarSesiStaf>> {
  try {
    const [{ data, error }, tahap] = await Promise.all([
      sb.rpc('chat_sesi_ringkas', { p_limit: BATAS_SESI_DAFTAR, p_include_selesai: opsi.sertakanSelesai }),
      sb.from('penanganan').select(KOLOM_TAHAP_CHAT).eq('saluran', 'chat').in('status', ['menunggu', 'berjalan']),
    ]);
    if (error) return dariGalatDb(error, 'Gagal memuat sesi chat');
    return ok({
      sesi: (data ?? []) as RingkasSesi[],
      tahap: tahap.error ? null : ((tahap.data ?? []) as TahapChat[]),
    });
  } catch (e) {
    return dariPengecualian(e, 'Gangguan jaringan. Sesi chat tidak dapat dimuat.');
  }
}

/** Nama/kontak pengunjung satu sesi (null bila kosong). */
export async function muatKontakSesi(sb: SupabaseClient, sesiId: string): Promise<HasilChat<string | null>> {
  try {
    const { data } = await sb.from('chat_sesi').select(KOLOM_KONTAK_SESI).eq('id', sesiId).maybeSingle();
    return ok((data as { kontak_pengunjung?: string | null } | null)?.kontak_pengunjung || null);
  } catch (e) {
    return dariPengecualian(e, 'Gagal memuat kontak pengunjung.');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Referensi kecil (dimuat lewat useReferensi)
// ---------------------------------------------------------------------------------------------------------------

async function bacaDaftar<T>(kueri: PromiseLike<{ data: unknown; error: unknown }>): Promise<Hasil<T[]>> {
  try {
    const { data, error } = await kueri;
    if (error) return { data: null, error: pesanGalatReferensi(error) };
    return { data: (data ?? []) as T[], error: null };
  } catch (e) {
    return { data: null, error: pesanGalatReferensi(e) };
  }
}

/** Semua Layanan (nama untuk label; yang aktif dan ber-chat jadi tujuan teruskan), urut nama. */
export function muatLayananChatStaf(sb: SupabaseClient): Promise<Hasil<LayananChatStaf[]>> {
  return bacaDaftar<LayananChatStaf>(sb.from('layanan').select(KOLOM_LAYANAN_CHAT_STAF).order('nama'));
}

/** Id dan nama petugas (RLS membatasi sesuai peran) untuk label pemegang chat. */
export function muatNamaPetugasChat(sb: SupabaseClient): Promise<Hasil<PetugasNama[]>> {
  return bacaDaftar<PetugasNama>(sb.from('petugas').select(KOLOM_PETUGAS_NAMA));
}

/** Topik Front Office (tanpa Layanan) yang aktif, hanya dipakai pemegang tahap FO (Front Office / Admin). */
export function muatTopikFoChat(sb: SupabaseClient): Promise<Hasil<TopikFo[]>> {
  return bacaDaftar<TopikFo>(
    sb.from('topik_penanganan').select(KOLOM_TOPIK_FO).eq('aktif', true).is('layanan_id', null).order('urut').order('nama'),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Pesan (route /api/chat/messages) dan draf
// ---------------------------------------------------------------------------------------------------------------

interface Balasan {
  ok: boolean;
  status: number;
  /** Isi JSON; objek kosong bila badan bukan JSON. */
  json: Record<string, unknown>;
  /** false bila badan bukan JSON. */
  jsonSah: boolean;
}

async function panggil(url: string, kirim?: unknown): Promise<Balasan> {
  const init: RequestInit | undefined =
    kirim === undefined
      ? undefined
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(kirim) };
  const res = init ? await fetch(url, init) : await fetch(url);
  const json: unknown = await res.json().catch(() => undefined);
  const sah = typeof json === 'object' && json !== null;
  return { ok: res.ok, status: res.status, json: sah ? (json as Record<string, unknown>) : {}, jsonSah: sah };
}

const galatHttp = <T>(b: Balasan, cadangan: string): HasilChat<T> =>
  gagal('http', typeof b.json.error === 'string' && b.json.error ? b.json.error : cadangan, b);

/**
 * Pesan sesi terpilih. `riwayat` = seluruh percakapan lintas sesi (lingkup ditegakkan route/DB); `sebelum` = halaman lebih
 * lama dari waktu itu (hanya bersama `riwayat`). Balasan bukan 2xx = `http`.
 */
export async function muatPesanSesi(p: { sesiId: string; riwayat?: boolean; sebelum?: string }): Promise<HasilChat<DataPesanSesi>> {
  const url =
    `/api/chat/messages?sesi_id=${p.sesiId}` +
    (p.riwayat ? '&riwayat=1' : '') +
    (p.sebelum ? `&sebelum=${encodeURIComponent(p.sebelum)}` : '');
  try {
    const b = await panggil(url);
    if (!b.ok) return galatHttp(b, 'Gagal memuat pesan');
    return ok({
      messages: b.json.messages ? (b.json.messages as ChatMsg[]) : null,
      adaLebih: !!b.json.ada_lebih,
    });
  } catch (e) {
    return dariPengecualian(e, 'Gagal memuat pesan');
  }
}

/** Balasan teks petugas; `message` = pesan server pengganti kiriman (client_uuid yang sama membuat klik ulang idempoten). */
export async function kirimPesanStaf(p: { sesiId: string; isi: string; clientUuid: string }): Promise<HasilChat<{ message: ChatMsg | null }>> {
  try {
    const b = await panggil('/api/chat/messages', { sesi_id: p.sesiId, pengirim: 'petugas', isi: p.isi, client_uuid: p.clientUuid });
    if (!b.ok) return galatHttp(b, 'Gagal mengirim pesan');
    return ok({ message: b.json.message ? (b.json.message as ChatMsg) : null });
  } catch (e) {
    return dariPengecualian(e, 'Gagal mengirim pesan');
  }
}

/** Balasan hanya-foto: unggah ke R2 lalu simpan pesan lampiran. Pesan galat route/unggahan dipakai apa adanya. */
export async function kirimFotoStaf(p: { sesiId: string; berkas: File }): Promise<HasilChat<{ message: ChatMsg | null }>> {
  try {
    const lampiran = await unggahLampiranChat(p.sesiId, p.berkas);
    const b = await panggil('/api/chat/messages', { sesi_id: p.sesiId, isi: '', lampiran, client_uuid: crypto.randomUUID() });
    if (!b.ok) return galatHttp(b, 'Foto gagal dikirim');
    return ok({ message: b.json.message ? (b.json.message as ChatMsg) : null });
  } catch (e) {
    return dariPengecualian(e, 'Foto gagal dikirim');
  }
}

const PESAN_DRAF_JARINGAN = 'Gagal memuat draf balasan';

/** Draf balasan dari asisten untuk sesi ini. Tanpa draf di balasan sukses = `http` dengan pesan galat route. */
export async function buatDrafBalasan(sesiId: string): Promise<HasilChat<string>> {
  try {
    const b = await panggil('/api/chat/ai/draft', { sesi_id: sesiId });
    if (!b.jsonSah) return gagal('jaringan', PESAN_DRAF_JARINGAN, b);
    if (b.ok && typeof b.json.draft === 'string' && b.json.draft) return ok(b.json.draft);
    return galatHttp(b, 'Gagal membuat draf balasan');
  } catch (e) {
    return gagal('jaringan', PESAN_DRAF_JARINGAN, e);
  }
}
