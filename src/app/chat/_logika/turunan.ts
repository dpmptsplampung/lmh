// Turunan murni halaman chat pengunjung (rencana refaktor 2026-11-11 tugas 6.1): urutan FAQ, pencarian ?layanan=,
// keputusan tampilan awal, teks sambutan/pemberitahuan, dan nilai turunan yang dulu dihitung di badan page.tsx.
// Tanpa I/O: waktu dan id diberikan pemanggil.
import type { ChatMsg } from '../merge';
import type { PercakapanRingkas } from '@/lib/chat/percakapan';
import type { FaqChat, LayananChat } from '@/lib/data/chat-pengunjung';
import type { StatusSesi, Tampilan } from './mesinChat';

/**
 * FAQ layanan terpilih lebih dulu, lalu FAQ umum; di dalam tiap kelompok menurut `urutan` (sort stabil: yang `urutan`-nya
 * sama tetap dalam urutan dari database).
 */
export function urutkanFaq(daftar: readonly FaqChat[], layananId: string): FaqChat[] {
  const kelompok = (f: FaqChat) => (f.layanan_id === layananId ? 0 : 1);
  return [...daftar].sort((a, b) => kelompok(a) - kelompok(b) || (a.urutan ?? 0) - (b.urutan ?? 0));
}

/** Layanan dari parameter ?layanan=<id|nama> (tautan popup etalase dan UMKM): id persis, nama persis, lalu nama memuat. */
export function cariLayananDariParam<L extends Pick<LayananChat, 'id' | 'nama'>>(
  daftar: readonly L[],
  param: string | null,
): L | undefined {
  if (!param) return undefined;
  const kecil = param.toLowerCase();
  return daftar.find((l) => l.id === param || l.nama.toLowerCase() === kecil || l.nama.toLowerCase().includes(kecil));
}

export type KeputusanAwal = { buka: PercakapanRingkas } | { tampilan: 'daftar' | 'baru' };

/**
 * Tampilan pertama setelah daftar percakapan dimuat: ?layanan= yang sudah punya percakapan dibuka langsung; ?layanan=
 * tanpa percakapan -> formulir; tanpa parameter -> daftar bila ada percakapan, selain itu formulir. `items` null = daftar
 * gagal dimuat (daftar dengan galat + Coba lagi).
 */
export function keputusanAwal(items: readonly PercakapanRingkas[] | null, cari: { id: string } | undefined): KeputusanAwal {
  if (items === null) return { tampilan: 'daftar' };
  const ada = cari ? items.find((i) => i.layananId === cari.id) : undefined;
  if (ada) return { buka: ada };
  if (cari) return { tampilan: 'baru' };
  return { tampilan: items.length > 0 ? 'daftar' : 'baru' };
}

export const teksSambutan = (nama: string, layananNama: string, botAktif: boolean) =>
  `Halo Bapak/Ibu ${nama}.\nSelamat datang di layanan Live Chat ${layananNama || 'DPMPTSP'}.\n` +
  (botAktif
    ? 'Saya adalah asisten virtual (bot) yang siap menjawab pertanyaan Anda secara otomatis. Silakan pilih salah satu menu FAQ di bawah atau ketik langsung pertanyaan Anda.'
    : 'Layanan chatbot FAQ saat ini nonaktif. Kami sedang menghubungkan Anda ke petugas operasional. Mohon tunggu...');

/** Pesan sambutan lokal sesi baru (bukan pesan server). */
export function pesanSambutan(p: { nama: string; layananNama: string; botAktif: boolean; waktu: string }): ChatMsg {
  return {
    id: 'welcome',
    pengirim: 'bot',
    isi: teksSambutan(p.nama, p.layananNama, p.botAktif),
    created_at: p.waktu,
    local: 'notice',
  };
}

/** Pemberitahuan lokal (rate-limit, galat bot, teks tunggu); `transient` hilang otomatis saat jawaban bot tiba. */
export function pesanPemberitahuan(isi: string, p: { id: string; waktu: string; transient?: boolean }): ChatMsg {
  return { id: `notice-${p.id}`, pengirim: 'bot', isi, created_at: p.waktu, local: 'notice', transient: p.transient ?? false };
}

export const TEKS_OFFLINE =
  'Anda sedang offline. Pesan tidak dapat dikirim dan tidak akan diterima petugas. Silakan coba lagi saat koneksi kembali.';
export const TEKS_BOT_DIPROSES =
  'Pertanyaan Anda masih diproses. Jawaban akan muncul otomatis di sini; tidak perlu mengirim ulang.';
export const TEKS_BOT_TERLALU_CEPAT = 'Anda mengirim pertanyaan terlalu cepat. Mohon tunggu sebentar lalu coba lagi.';
export const TEKS_BOT_TIDAK_TERSEDIA = 'Maaf, asisten virtual sedang tidak tersedia. Silakan coba lagi beberapa saat.';
export const TEKS_PETUGAS_GAGAL = 'Gagal menghubungkan ke petugas. Silakan coba lagi.';
export const TEKS_PETUGAS_GAGAL_JARINGAN = 'Gagal menghubungkan ke petugas. Periksa koneksi Anda lalu coba lagi.';
export const TEKS_MINTA_PETUGAS_LAMA = 'Saya ingin berbicara dengan petugas loket.';

/** Teks saat permintaan ke bot gagal di tingkat jaringan: batas waktu habis dibedakan menurut jam layanan. */
export function teksBotGagal(p: { waktuHabis: boolean; tutup: boolean }): string {
  if (!p.waktuHabis) return TEKS_BOT_TIDAK_TERSEDIA;
  return p.tutup
    ? 'Asisten virtual belum menjawab. Jika jawaban belum muncul, kirim ulang pertanyaan Anda beberapa saat lagi.'
    : 'Asisten virtual belum menjawab. Jika jawaban belum muncul, tekan "Hubungkan ke Petugas".';
}

/** Tampilan yang dirender: 'awal' menjadi 'memuat' selama cek login / daftar belum siap, selain itu formulir. */
export function tampilanAktif(p: {
  tampilan: Tampilan;
  memeriksa: boolean;
  masuk: boolean;
  daftarSiap: boolean;
}): Exclude<Tampilan, 'awal'> | 'memuat' {
  if (p.tampilan !== 'awal') return p.tampilan;
  return p.memeriksa || (p.masuk && !p.daftarSiap) ? 'memuat' : 'baru';
}

/** Layanan sesi (atau pilihan formulir bila belum ada sesi); undefined = diarsipkan / tidak lagi melayani chat. */
export function layananPercakapan<L extends Pick<LayananChat, 'id'>>(
  daftar: readonly L[],
  sesiLayananId: string | null,
  layananId: string,
): L | undefined {
  return daftar.find((l) => l.id === (sesiLayananId ?? layananId));
}

/** Percakapan Layanan yang tidak lagi melayani chat hanya bisa dibaca (setelah daftar layanan berhasil dimuat). */
export const hanyaBaca = (p: {
  tampilan: Tampilan;
  memuatLayanan: boolean;
  galatLayanan: boolean;
  adaLayanan: boolean;
}): boolean => p.tampilan === 'percakapan' && !p.memuatLayanan && !p.galatLayanan && !p.adaLayanan;

/** Bubble milik pengunjung terakhir -> status "Terkirim" (hanya bila sudah tersimpan). */
export const idPesanPengunjungTerakhir = (pesan: readonly ChatMsg[]): string | undefined =>
  [...pesan].reverse().find((m) => m.pengirim === 'pengunjung')?.id;

export function placeholderPesan(p: { daring: boolean; hanyaBaca: boolean; sesiId: string | null; status: StatusSesi }): string {
  if (!p.daring) return 'Anda sedang offline...';
  if (p.hanyaBaca) return 'Percakapan ini hanya dapat dibaca...';
  if (!p.sesiId || p.status === 'selesai') return 'Ketik pesan untuk memulai sesi baru...';
  return 'Ketik pertanyaan Anda...';
}
