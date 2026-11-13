// Mesin keadaan percakapan pengunjung (rencana refaktor 2026-11-11 tugas 6.1): reducer murni yang dipakai _hook/useMesinChat.
// Menggantikan belasan useState + ref cermin di page.tsx lama (tampilan, sesi terbuka, status sesi, generasi R4, indikator
// "mengetik", galat formulir). Tanpa I/O dan tanpa React; transisinya diuji sebagai fungsi murni.
//
// "Mode" percakapan (bot / menunggu petugas / petugas / selesai / hanya-baca) TIDAK disimpan: ia turunan dari `status`,
// status jadwal Layanan (`tutup`), dan ada-tidaknya Layanan, jadi dihitung lewat modePercakapan() dan modeBot().
import type { PercakapanRingkas } from '@/lib/chat/percakapan';
import type { SesiBaru, StatusSesiChat } from '@/lib/data/chat-pengunjung';

export type StatusSesi = StatusSesiChat;
/** 'awal' = belum diputuskan (formulir bila belum login; "memuat" bila login dan daftar masih dimuat). */
export type Tampilan = 'awal' | 'daftar' | 'baru' | 'percakapan';

export interface KeadaanChat {
  tampilan: Tampilan;
  /** Layanan percakapan / pilihan formulir (dropdown, ?layanan=, percakapan yang dibuka). */
  layananId: string;
  /** Sesi TERBUKA percakapan ini; null = pesan berikutnya membuat sesi baru (sesi terakhir selesai). */
  sesiId: string | null;
  /** Layanan milik sesi (bukan dropdown): sumber nama di banner dan label petugas. */
  sesiLayananId: string | null;
  status: StatusSesi;
  /** R4: naik tiap percakapan dibuka/ditinggalkan; respons sinkronisasi dari generasi lama dibuang. */
  generasi: number;
  /** Jumlah kiriman yang menunggu jawaban bot (kiriman beruntun tidak saling mematikan indikator). */
  mengetik: number;
  /** Pembuatan sesi baru (consent + chat_sesi) sedang berjalan. */
  memulai: boolean;
  galat: {
    /** Gagal memulai sesi / offline saat mulai. */
    setup: string;
    /** S1: pencatatan consent_log gagal (memblokir sesi; tampil bersama Coba lagi). */
    consent: string;
  };
}

export type AksiChat =
  | { jenis: 'pilihLayanan'; layananId: string }
  | { jenis: 'buka'; percakapan: PercakapanRingkas }
  | { jenis: 'kembali' }
  | { jenis: 'tampilkan'; tampilan: 'daftar' | 'baru'; bersihkanGalat?: boolean }
  | { jenis: 'mulai' }
  | { jenis: 'selesaiMulai' }
  | { jenis: 'galatSetup'; pesan: string }
  | { jenis: 'galatConsent'; pesan: string }
  | { jenis: 'hapusGalatConsent' }
  | { jenis: 'sesiDibuat'; sesi: SesiBaru; layananId: string; buka: boolean }
  /** Status dari server. `sesiId` diisi bila balasan menyebut sesinya: status sesi lain (percakapan lama) dibuang. */
  | { jenis: 'status'; status: StatusSesi; sesiId?: string }
  | { jenis: 'mengetik'; tambah: 1 | -1 };

export const KEADAAN_AWAL_CHAT: KeadaanChat = {
  tampilan: 'awal',
  layananId: '',
  sesiId: null,
  sesiLayananId: null,
  status: 'bot',
  generasi: 0,
  mengetik: 0,
  memulai: false,
  galat: { setup: '', consent: '' },
};

export function kurangiChat(k: KeadaanChat, a: AksiChat): KeadaanChat {
  switch (a.jenis) {
    case 'pilihLayanan':
      return { ...k, layananId: a.layananId };
    case 'buka': {
      const p = a.percakapan;
      return {
        ...k,
        tampilan: 'percakapan',
        layananId: p.layananId,
        sesiLayananId: p.layananId,
        sesiId: p.sesiTerbukaId,
        status: (p.sesiTerbukaId ? p.statusTerakhir : 'selesai') as StatusSesi,
        generasi: k.generasi + 1,
        galat: { ...k.galat, setup: '' },
      };
    }
    case 'kembali':
      return { ...k, tampilan: 'daftar', generasi: k.generasi + 1 };
    case 'tampilkan':
      return { ...k, tampilan: a.tampilan, galat: a.bersihkanGalat ? { ...k.galat, setup: '' } : k.galat };
    case 'mulai':
      return { ...k, memulai: true, galat: { setup: '', consent: '' } };
    case 'selesaiMulai':
      return { ...k, memulai: false };
    case 'galatSetup':
      return { ...k, galat: { ...k.galat, setup: a.pesan } };
    case 'galatConsent':
      return { ...k, galat: { ...k.galat, consent: a.pesan } };
    case 'hapusGalatConsent':
      return k.galat.consent ? { ...k, galat: { ...k.galat, consent: '' } } : k;
    case 'sesiDibuat':
      return {
        ...k,
        sesiId: a.sesi.id,
        sesiLayananId: a.layananId,
        status: a.sesi.status,
        tampilan: a.buka ? 'percakapan' : k.tampilan,
      };
    case 'status':
      if (a.sesiId && a.sesiId !== k.sesiId) return k;
      return k.status === a.status ? k : { ...k, status: a.status };
    case 'mengetik':
      return { ...k, mengetik: Math.max(0, k.mengetik + a.tambah) };
  }
}

/**
 * Bot menjawab pada sesi 'bot', atau sesi 'eskalasi' yang menunggu petugas DI LUAR jam operasional Layanan (tidak ada
 * petugas yang akan menjawab; bot tetap membantu). Sesi 'aktif' (dipegang petugas) tidak pernah dijawab bot.
 */
export const modeBot = (status: StatusSesi, tutup: boolean, botAktif: boolean): boolean =>
  botAktif && (status === 'bot' || (status === 'eskalasi' && tutup));

export type ModePercakapan = 'hanyaBaca' | 'selesai' | 'bot' | 'menunggu' | 'menungguLuarJam' | 'petugas';

/** Mode bilah status percakapan: satu cabang untuk tiap kombinasi (urutannya mengikuti prioritas tampilan lama). */
export function modePercakapan(
  k: Pick<KeadaanChat, 'sesiId' | 'status'>,
  o: { tutup: boolean; hanyaBaca: boolean },
): ModePercakapan {
  if (o.hanyaBaca) return 'hanyaBaca';
  if (!k.sesiId || k.status === 'selesai') return 'selesai';
  if (k.status === 'bot') return 'bot';
  if (k.status === 'eskalasi') return o.tutup ? 'menungguLuarJam' : 'menunggu';
  return 'petugas';
}
