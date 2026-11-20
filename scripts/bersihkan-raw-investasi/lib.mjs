// Logika murni skrip sapu objek PDF sementara investasi (diuji di lib.test.ts).
// Aturan sama dengan bersihkanRawLama di src/app/api/investment-docs/_logika/unggahan.ts.

export const AWALAN_RAW = 'investment-docs/raw/';
export const BATAS_JAM = 24;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const POLA_RAW = new RegExp(`^raw/${UUID}/${UUID}\\.pdf$`);

/** Kunci penuh `investment-docs/raw/<uid>/<uuid>.pdf` yang sah dan lebih tua dari batas. */
export function yatim(objek, sekarang = Date.now(), batasJam = BATAS_JAM) {
  const batas = sekarang - batasJam * 60 * 60 * 1000;
  if (!objek.key.startsWith('investment-docs/')) return false;
  if (!POLA_RAW.test(objek.key.slice('investment-docs/'.length))) return false;
  return objek.lastModified.getTime() < batas;
}

export function pilihYatim(daftar, sekarang, batasJam) {
  return daftar.filter((o) => yatim(o, sekarang, batasJam));
}

export function ringkasan(terpilih) {
  return { jumlah: terpilih.length, byte: terpilih.reduce((n, o) => n + (o.ukuran ?? 0), 0) };
}
