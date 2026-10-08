// Pesan & deteksi galat "layanan tutup" (RBAC Tahap 1 §2) untuk klien yang insert visit langsung.
export const PESAN_LAYANAN_TUTUP = 'Layanan tutup pukul 16.00 WIB, buka kembali pada jam kerja berikutnya.';

export function isLayananTutupError(err: unknown): boolean {
  const e = err as { message?: string; details?: string; code?: string } | null;
  return (
    e?.details === 'LAYANAN_TUTUP' ||
    e?.code === 'LAYANAN_TUTUP' ||
    (e?.message ?? '').includes('tutup pukul 16.00 WIB')
  );
}

export function pesanCheckinDitolak(n: number): string {
  return n === 1
    ? 'Satu check-in offline Anda tidak dapat diproses karena layanan sudah tutup. Silakan daftar ulang pada jam kerja berikutnya.'
    : `${n} check-in offline Anda tidak dapat diproses karena layanan sudah tutup. Silakan daftar ulang pada jam kerja berikutnya.`;
}
