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
