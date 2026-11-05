// Kontrak bentuk data pengaturan layar TV antrean. Ditulis oleh halaman Layar admin, dibaca oleh layar TV.
// Pengumuman disimpan di site_settings sebagai tiga kunci teks (registry bernilai string, bukan jsonb).
// Nilai lama `running_text_layar` tetap menjadi pengumuman 1.

export const KUNCI_PENGUMUMAN_LAYAR = [
  'running_text_layar',
  'running_text_layar_2',
  'running_text_layar_3',
] as const;

export const BATAS_PENGUMUMAN_LAYAR = 200;
export const BATAS_NAMA_LAYAR = 40;

/** Pengumuman terisi menurut urutan 1..3: dirapikan, yang kosong dilewati, dipotong ke batas panjang. */
export function bacaPengumuman(settings: Record<string, string | null | undefined>): string[] {
  const hasil: string[] = [];
  for (const kunci of KUNCI_PENGUMUMAN_LAYAR) {
    const nilai = (settings[kunci] ?? '').trim().slice(0, BATAS_PENGUMUMAN_LAYAR).trim();
    if (nilai) hasil.push(nilai);
  }
  return hasil;
}

/** Nama yang dipakai di kartu dan pita panggilan: `nama_layar` bila terisi, selain itu `nama`. */
export function namaTampilLayar(l: { nama: string; nama_layar?: string | null }): string {
  return l.nama_layar?.trim() || l.nama;
}

/** Urutan khusus layar TV: `urutan_layar` naik, yang null di akhir; sisanya menurut nama. Tidak mengubah masukan. */
export function urutkanUntukLayar<T extends { nama: string; urutan_layar?: number | null }>(daftar: readonly T[]): T[] {
  return [...daftar].sort((a, b) => {
    const ua = a.urutan_layar ?? Number.POSITIVE_INFINITY;
    const ub = b.urutan_layar ?? Number.POSITIVE_INFINITY;
    if (ua !== ub) return ua < ub ? -1 : 1;
    return a.nama.localeCompare(b.nama, 'id');
  });
}
