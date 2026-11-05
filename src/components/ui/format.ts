// Format angka bersama komponen UI "Dasbor". Semua angka tampil dengan lokal id-ID
// (titik ribuan, koma desimal) agar seragam di KPI, tabel, tooltip grafik, dan CSV.

const lokal = 'id-ID';

/** Bilangan bulat atau desimal terbatas: 14653 -> "14.653", 15.5 -> "15,5". */
export function formatAngka(nilai: number, maksDesimal = 1): string {
  if (!Number.isFinite(nilai)) return '-';
  return new Intl.NumberFormat(lokal, { maximumFractionDigits: maksDesimal }).format(nilai);
}

/** Persen dengan satu desimal: 15.5 -> "15,5%". Nilai sudah dalam satuan persen (bukan pecahan). */
export function formatPersen(nilai: number, maksDesimal = 1): string {
  if (!Number.isFinite(nilai)) return '-';
  return `${formatAngka(nilai, maksDesimal)}%`;
}

/** Ucapan untuk pembaca layar: 15.5 -> "15,5 persen". */
export function ucapkanPersen(nilai: number, maksDesimal = 1): string {
  return `${formatAngka(nilai, maksDesimal)} persen`;
}
