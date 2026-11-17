// Kode galat Pendataan Khusus (migrasi 202610300001/0002) dari pesan error RPC / trigger.
export type KodeGalatKhusus =
  | 'KHUSUS_WAJIB'
  | 'KHUSUS_TIDAK_VALID'
  | 'KHUSUS_TIDAK_BERLAKU'
  | 'DATA_TIDAK_VALID'
  | 'JENIS_TERKUNCI'
  | 'SUDAH_DIISI'
  | 'LAYANAN_FORMULIR_TETAP'
  | 'OPSI_TIDAK_VALID'
  | 'ISIAN_TERLALU_BANYAK'
  | 'LAYANAN_TETAP'
  | 'ISIAN_TIDAK_DITEMUKAN';

const POLA =
  /\b(KHUSUS_WAJIB|KHUSUS_TIDAK_VALID|KHUSUS_TIDAK_BERLAKU|DATA_TIDAK_VALID|JENIS_TERKUNCI|SUDAH_DIISI|LAYANAN_FORMULIR_TETAP|OPSI_TIDAK_VALID|ISIAN_TERLALU_BANYAK|LAYANAN_TETAP|ISIAN_TIDAK_DITEMUKAN)\b/;

export const PESAN_GALAT_KHUSUS: Record<KodeGalatKhusus, string> = {
  KHUSUS_WAJIB: 'Ada isian Pendataan Khusus yang wajib belum diisi.',
  KHUSUS_TIDAK_VALID: 'Ada isian Pendataan Khusus yang tidak valid. Muat ulang formulir lalu periksa isian.',
  KHUSUS_TIDAK_BERLAKU: 'Pendataan Khusus hanya berlaku untuk chat yang diselesaikan petugas Layanan.',
  DATA_TIDAK_VALID: 'Data identitas pengunjung tidak valid. Periksa format isian.',
  JENIS_TERKUNCI: 'Jenis isian yang pernah diisi tidak dapat diubah. Sembunyikan isian ini dan buat isian baru.',
  SUDAH_DIISI: 'Isian yang pernah diisi tidak dapat dihapus. Sembunyikan saja dari formulir baru.',
  LAYANAN_FORMULIR_TETAP: 'Layanan ini memakai formulir tetap (OSS / Non OSS); Pendataan Khusus tidak berlaku.',
  OPSI_TIDAK_VALID: 'Pilihan harus 2-20 butir teks (maksimal 100 karakter) dan tidak boleh kembar.',
  ISIAN_TERLALU_BANYAK: 'Jumlah isian per Layanan sudah mencapai batas 40.',
  LAYANAN_TETAP: 'Isian tidak dapat dipindahkan ke Layanan lain.',
  ISIAN_TIDAK_DITEMUKAN: 'Isian tidak ditemukan di Layanan ini, atau Anda tidak berwenang mengubah urutannya.',
};

/** Kode galat dari error apa pun (objek PostgREST `{message}` atau `MutasiError.asal`). */
export function kodeGalatKhusus(e: unknown): KodeGalatKhusus | null {
  if (typeof e !== 'object' || e === null) return null;
  const asal = (e as { asal?: unknown }).asal;
  const sumber = typeof asal === 'object' && asal !== null ? asal : e;
  const pesan = (sumber as { message?: unknown }).message;
  return typeof pesan === 'string' ? ((pesan.match(POLA)?.[1] as KodeGalatKhusus | undefined) ?? null) : null;
}

// ── Langkah Mulai Layanan dan draf (G5; migrasi 202611160002) ────────────────────────────────────────────────

export interface GalatLangkah {
  /** Pesan siap tampil, tanpa detail teknis. */
  pesan: string;
  /** true = tampilan basi (tiket berubah di tempat lain): pemanggil memuat ulang daftar/isian. */
  muatUlang: boolean;
  /** true = sesi tidak sah: tidak ada gunanya mencoba lagi sebelum masuk kembali. */
  sesiHabis: boolean;
}

const POLA_LANGKAH =
  /\b(SESI_TIDAK_SAH|FORBIDDEN|BUKAN_PEMILIK|NOT_FOUND|SUDAH_DIAMBIL|BUKAN_HARI_INI|INVALID_STATUS|PENANGANAN_AKTIF|PENANGANAN_TIDAK_SESUAI|KHUSUS_TIDAK_VALID|KHUSUS_WAJIB|KHUSUS_NONAKTIF|LAYANAN_TETAP|INVALID_PAYLOAD|TOPIK_SISTEM_TIDAK_ADA)\b/;

const PESAN_LANGKAH: Record<string, { pesan: string; muatUlang?: boolean; sesiHabis?: boolean }> = {
  SESI_TIDAK_SAH: { pesan: 'Sesi Anda sudah tidak berlaku (masuk di perangkat lain atau terlalu lama tidak aktif). Silakan masuk kembali.', sesiHabis: true },
  FORBIDDEN: { pesan: 'Anda tidak berwenang mengubah pendataan tiket ini.', muatUlang: true },
  BUKAN_PEMILIK: { pesan: 'Tiket ini sedang dilayani petugas lain. Hanya petugas yang memulai yang dapat mengubah pendataannya.', muatUlang: true },
  NOT_FOUND: { pesan: 'Tiket atau Layanan tidak ditemukan.', muatUlang: true },
  SUDAH_DIAMBIL: { pesan: 'Tiket ini sudah ditangani petugas lain.', muatUlang: true },
  BUKAN_HARI_INI: { pesan: 'Tiket ini bukan antrean hari ini. Muat ulang daftar antrean.', muatUlang: true },
  INVALID_STATUS: { pesan: 'Status tiket sudah berubah (mungkin sudah selesai atau dialihkan). Daftar dimuat ulang.', muatUlang: true },
  PENANGANAN_AKTIF: { pesan: 'Tiket ini masih punya tahap layanan lain yang berjalan. Muat ulang lalu coba lagi.', muatUlang: true },
  PENANGANAN_TIDAK_SESUAI: { pesan: 'Tahap layanan tiket ini tidak sesuai. Muat ulang lalu coba lagi.', muatUlang: true },
  KHUSUS_TIDAK_VALID: { pesan: 'Ada isian Pendataan Khusus yang tidak valid. Isian dimuat ulang; periksa lalu coba lagi.', muatUlang: true },
  KHUSUS_WAJIB: { pesan: 'Ada isian Pendataan Khusus yang wajib belum diisi.' },
  KHUSUS_NONAKTIF: { pesan: 'Pendataan Khusus Layanan ini sedang dinonaktifkan Admin. Isian dimuat ulang.', muatUlang: true },
  LAYANAN_TETAP: { pesan: 'Layanan ini memakai formulir tetap (OSS / Non OSS), bukan Pendataan Khusus.', muatUlang: true },
  INVALID_PAYLOAD: { pesan: 'Jalur pengisian ini tidak berlaku untuk Layanan tersebut. Muat ulang halaman.', muatUlang: true },
  TOPIK_SISTEM_TIDAK_ADA: { pesan: 'Topik bawaan sistem untuk Layanan ini tidak tersedia. Hubungi Admin.' },
};

/**
 * Memilah galat RPC langkah/draf/selesai (objek PostgREST `{message}` atau `MutasiError.asal`) menjadi pesan Indonesia dan
 * petunjuk tindakan. Galat tak dikenal: `cadangan` (atau pesan umum) dan tanpa muat ulang.
 */
export function pesanGalatLangkah(e: unknown, cadangan = 'Terjadi kesalahan. Coba lagi.'): GalatLangkah {
  let pesan: string | null = null;
  if (typeof e === 'object' && e !== null) {
    const asal = (e as { asal?: unknown }).asal;
    const sumber = typeof asal === 'object' && asal !== null ? asal : e;
    const m = (sumber as { message?: unknown }).message;
    pesan = typeof m === 'string' ? m : null;
  }
  const kode = pesan?.match(POLA_LANGKAH)?.[1];
  const info = kode ? PESAN_LANGKAH[kode] : undefined;
  if (info) return { pesan: info.pesan, muatUlang: info.muatUlang === true, sesiHabis: info.sesiHabis === true };
  return { pesan: cadangan, muatUlang: false, sesiHabis: false };
}
