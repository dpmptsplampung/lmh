// Tampilan token layar di halaman admin. Nilai token sebenarnya tidak berubah:
// kelompok spasi hanya untuk dibaca dan diketik dengan remote TV.

const POLA_TOKEN_ANGKA = /^\d{8}$/;

/** "48205917" -> "4820 5917". Token lama (bukan 8 angka) ditampilkan apa adanya. */
export function formatTokenTampilan(token: string): string {
  return POLA_TOKEN_ANGKA.test(token) ? `${token.slice(0, 4)} ${token.slice(4)}` : token;
}

/** Token baru berupa 8 angka; token lama 32 karakter tetap sah. */
export function tokenBerupaAngka(token: string): boolean {
  return POLA_TOKEN_ANGKA.test(token);
}

/** Tautan lengkap yang disalin admin. */
export function tautanLayar(origin: string, token: string): string {
  return `${origin}/layar/${token}`;
}
