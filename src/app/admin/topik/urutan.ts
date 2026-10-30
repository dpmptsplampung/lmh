// Aturan urutan Topik Penanganan: geser satu langkah ke atas/bawah dengan menukar `urut` dua topik bertetangga.
// Topik berurutan >= 99 ("Lainnya") dikunci di bawah: tidak bisa naik, dan topik biasa tidak bisa turun melewatinya.
export const URUT_KUNCI = 99;

export interface UrutTopik {
  id: string;
  urut: number;
}

export const terkunci = (t: UrutTopik) => t.urut >= URUT_KUNCI;

/** Apakah topik di `indeks` (daftar sudah terurut) boleh digeser ke `arah` (-1 naik, +1 turun). */
export function bisaGeser(daftar: UrutTopik[], indeks: number, arah: -1 | 1): boolean {
  const t = daftar[indeks];
  const tujuan = daftar[indeks + arah];
  if (!t || !tujuan) return false;
  if (terkunci(t) || terkunci(tujuan)) return false;
  return true;
}

/**
 * Perubahan `urut` yang diperlukan untuk menggeser satu langkah. Biasanya dua baris bertukar nilai; bila nilai keduanya
 * kembar (tak ada yang bisa ditukar), seluruh topik biasa dinomori ulang 1..n menurut urutan baru (hanya yang berubah dikirim).
 */
export function hitungGeser(daftar: UrutTopik[], indeks: number, arah: -1 | 1): UrutTopik[] {
  if (!bisaGeser(daftar, indeks, arah)) return [];
  const a = daftar[indeks];
  const b = daftar[indeks + arah];
  if (a.urut !== b.urut) return [{ id: a.id, urut: b.urut }, { id: b.id, urut: a.urut }];
  const baru = [...daftar];
  [baru[indeks], baru[indeks + arah]] = [baru[indeks + arah], baru[indeks]];
  const hasil: UrutTopik[] = [];
  let n = 0;
  for (const t of baru) {
    if (terkunci(t)) continue;
    n += 1;
    const urut = Math.min(URUT_KUNCI - 1, n);
    if (urut !== t.urut) hasil.push({ id: t.id, urut });
  }
  return hasil;
}
