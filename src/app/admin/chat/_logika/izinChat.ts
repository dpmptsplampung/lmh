// Izin dan turunan tampilan kotak masuk chat staf (refaktor G7, tugas 7.1): fungsi MURNI, tanpa I/O dan tanpa React.
// Aturan yang sama ditegakkan RPC chat_* dan route pesan; di sini hanya menentukan tombol/catatan mana yang tampil.
// Tidak mengubah lingkup hak akses (boleh_chat_sesi, lib/chat/akses.ts, RLS tetap penegak).
import type { PeranTahapChat } from '@/lib/chat-staf';
import type { PeranStaf, RingkasSesi, StatusSesiStaf, TahapChat } from '@/lib/data/chat-staf';
import type { StatusLayananChat } from '@/lib/chat/status-layanan';

export const LABEL_STATUS: Record<StatusSesiStaf, string> = {
  bot: 'Bot',
  eskalasi: 'Menunggu Diambil',
  aktif: 'Aktif',
  selesai: 'Selesai',
};

/** Siapa yang sedang membuka halaman (profil petugas); null sebelum profil termuat. */
export interface PenggunaChat {
  petugasId: string | null;
  role: PeranStaf | null;
}

/** Sesi menunggu petugas layanan: sudah diteruskan FO dan tahap layanan belum diambil. */
export function menungguLayanan(tahap: TahapChat | null): boolean {
  return !!tahap && tahap.status === 'menunggu' && tahap.peran_tahap === 'layanan';
}

/** Hanya staf yang MENGAMBIL (sesi aktif, dipegang dirinya) yang boleh membalas / meneruskan / menyelesaikan. Admin pun harus mengambil dulu. */
export function adalahPemilik(s: RingkasSesi, pengguna: PenggunaChat): boolean {
  return s.status === 'aktif' && !!pengguna.petugasId && s.ditangani_oleh === pengguna.petugasId;
}

export function dipegangLain(s: RingkasSesi, pengguna: PenggunaChat): boolean {
  return s.status === 'aktif' && !!s.ditangani_oleh && s.ditangani_oleh !== pengguna.petugasId;
}

/** Peran tahap milik pemilik: dari tahap terbuka; bila belum terbaca, turunkan dari peran akun. */
export function peranPemilik(tahap: TahapChat | null, pengguna: PenggunaChat): PeranTahapChat {
  return tahap?.peran_tahap ?? (pengguna.role === 'petugas' ? 'layanan' : 'fo');
}

/** Izin tombol dan kotak balasan untuk satu sesi. */
export interface IzinSesi {
  pemilik: boolean;
  dipegangLain: boolean;
  menungguLayanan: boolean;
  peranPemilik: PeranTahapChat;
  bolehBalas: boolean;
  bolehAmbil: boolean;
  bolehAmbilAlih: boolean;
  bolehTeruskan: boolean;
}

export function izinSesi(s: RingkasSesi, tahap: TahapChat | null, pengguna: PenggunaChat): IzinSesi {
  const pemilik = adalahPemilik(s, pengguna);
  const lain = dipegangLain(s, pengguna);
  const menunggu = menungguLayanan(tahap);
  const peran = peranPemilik(tahap, pengguna);
  return {
    pemilik,
    dipegangLain: lain,
    menungguLayanan: menunggu,
    peranPemilik: peran,
    bolehBalas: pemilik,
    // Setelah diteruskan, FO tidak boleh mengambilnya lagi (DB menolak dengan FORBIDDEN); hanya petugas layanan / Admin.
    bolehAmbil: (s.status === 'bot' || s.status === 'eskalasi') && !(pengguna.role === 'front_office' && menunggu),
    bolehAmbilAlih: lain && pengguna.role === 'admin',
    bolehTeruskan: pemilik && peran === 'fo',
  };
}

export function labelStatus(s: RingkasSesi, tahap: TahapChat | null): string {
  return s.status === 'eskalasi' && menungguLayanan(tahap) ? 'Menunggu Petugas Layanan' : LABEL_STATUS[s.status];
}

/** Nama pemegang sesi aktif; 'petugas lain' bila nama tidak termuat (RLS). null bila sesi tak punya pemegang. */
export function namaPemegang(s: RingkasSesi, petugasNama: Readonly<Record<string, string>>): string | null {
  return s.ditangani_oleh ? petugasNama[s.ditangani_oleh] ?? 'petugas lain' : null;
}

/** Chat yang menunggu diambil (kotak masuk) tampil paling atas; urutan lain tetap (sort stabil). */
export function urutkanSesi(sesi: readonly RingkasSesi[]): RingkasSesi[] {
  return [...sesi].sort((a, b) => Number(b.status === 'eskalasi') - Number(a.status === 'eskalasi'));
}

export function hitungSesi(sesi: readonly RingkasSesi[]): { aktif: number; menunggu: number } {
  return {
    aktif: sesi.filter((s) => s.status !== 'selesai').length,
    menunggu: sesi.filter((s) => s.status === 'eskalasi').length,
  };
}

/** Penanda belum dibaca: bukan sesi terpilih, ada pesan belum dibalas, dan belum dibuka sejak pesan terakhir itu. */
export function belumDibaca(
  s: RingkasSesi,
  terpilihId: string | null,
  dibuka: Readonly<Record<string, string | null>>,
): boolean {
  return s.id !== terpilihId && s.unread && dibuka[s.id] !== s.last_pesan_at;
}

/** Sesi yang dibuka/ditinggalkan dianggap terbaca sampai ada pesan yang lebih baru. */
export function tandaiTerbaca(
  dibuka: Readonly<Record<string, string | null>>,
  s: RingkasSesi,
): Record<string, string | null> {
  return { ...dibuka, [s.id]: s.last_pesan_at };
}

/** Pembatas sesi hanya bila percakapan memuat lebih dari satu sesi (riwayat lintas sesi, Fase 5). */
export function adaBanyakSesi(pesan: readonly { sesi_id?: string }[]): boolean {
  return new Set(pesan.map((m) => m.sesi_id).filter(Boolean)).size > 1;
}

/**
 * Hari tanpa pelayanan PER LAYANAN (Fase 5, spec §4.4): Layanan sesi terpilih tidak beroperasi hari ini, sehingga chat tidak
 * dapat diambil, diambil alih, atau diteruskan (DB menolak HARI_TANPA_LAYANAN). null = beroperasi atau status belum diketahui
 * (gagal menilai = tombol tetap aktif; DB tetap penegak).
 */
export function alasanTanpaLayanan(status: StatusLayananChat | null, namaLayanan: string | undefined): string | null {
  if (!status?.hariTanpaLayanan) return null;
  return (
    `Chat tidak dapat diambil atau diteruskan karena ${namaLayanan ?? 'layanan ini'} tidak beroperasi hari ini` +
    `${status.liburKeterangan ? ` (hari libur: ${status.liburKeterangan})` : ' (di luar jadwal)'}. ` +
    'Pengunjung hanya dilayani asisten virtual; chat yang menunggu tidak ditutup otomatis sebelum ada hari operasional Layanan.'
  );
}

/** Catatan di atas kotak balasan bagi yang belum boleh membalas (urutan prioritas sama dengan halaman lama). */
export function catatanBalas(izin: IzinSesi, pemegang: string | null, alasanLibur: string | null): string {
  const tangani = `Chat ini sedang ditangani ${pemegang ?? 'petugas lain'}.`;
  if (alasanLibur) return izin.dipegangLain ? `${tangani} ${alasanLibur}` : alasanLibur;
  if (izin.dipegangLain) return `${tangani}${izin.bolehAmbilAlih ? ' Tekan "Ambil Alih Chat" (alasan wajib) untuk membalas.' : ''}`;
  if (izin.menungguLayanan && !izin.bolehAmbil) {
    return 'Chat ini sudah diteruskan ke petugas layanan. Petugas layanan yang akan mengambilnya.';
  }
  return 'Tekan "Ambil Chat" untuk mulai membalas pengunjung.';
}

/** Peringatan sesudah meneruskan chat (bukan galat; kontrak §2.2): null bila petugas hadir dan notifikasi terkirim. */
export function peringatanTeruskan(hasil: { layanan_nama: string; petugas_hadir: boolean; notifikasi_diantrekan: number }): string | null {
  if (!hasil.petugas_hadir) {
    return `Chat diteruskan ke ${hasil.layanan_nama}, tetapi belum ada petugas layanan itu yang hadir hari ini. Chat tetap menunggu di daftar mereka; hubungi petugas bila mendesak.`;
  }
  if (hasil.notifikasi_diantrekan === 0) {
    return `Chat diteruskan ke ${hasil.layanan_nama}, tetapi tidak ada notifikasi yang terkirim ke petugasnya. Chat tetap menunggu di daftar mereka.`;
  }
  return null;
}
