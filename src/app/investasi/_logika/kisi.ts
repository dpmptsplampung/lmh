/** Nilai `data-jumlah` untuk kisi kartu: 1 sampai 5 kartu ditata khusus (tanpa kolom kosong); selebihnya 3 kolom. */
export const jumlahKisi = (n: number): string => (n >= 1 && n <= 5 ? String(n) : 'banyak');
