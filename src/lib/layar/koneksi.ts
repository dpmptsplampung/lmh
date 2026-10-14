// Util koneksi untuk layar TV (audit T4): layar menyala berhari-hari tanpa pengawasan,
// jadi satu gangguan jaringan sesaat tidak boleh berubah menjadi keadaan permanen.

export const BACKOFF_AWAL_MS = 1_000;
export const BACKOFF_MAKS_MS = 30_000;
export const BATAS_WAKTU_MS = 10_000;

/** Jeda coba-ulang eksponensial: percobaan gagal ke-1 → 1 dtk, 2 → 2, 3 → 4 … maksimal 30 dtk. */
export function backoffMs(gagalBeruntun: number): number {
  const n = Math.max(1, Math.floor(gagalBeruntun));
  // Batasi eksponen agar 2 ** n tidak membengkak; hasil akhirnya tetap dibatasi BACKOFF_MAKS_MS.
  return Math.min(BACKOFF_MAKS_MS, BACKOFF_AWAL_MS * 2 ** Math.min(n - 1, 10));
}

/** Menolak (reject) bila `p` tidak selesai dalam `ms` — permintaan menggantung dianggap gangguan. */
export function denganBatas<T>(p: PromiseLike<T>, ms: number = BATAS_WAKTU_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    Promise.resolve(p).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e: unknown) => { clearTimeout(timer); reject(e instanceof Error ? e : new Error('gagal')); },
    );
  });
}
