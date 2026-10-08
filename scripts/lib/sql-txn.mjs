// Deteksi pernyataan kontrol transaksi (BEGIN/COMMIT/END/ROLLBACK/SAVEPOINT/RELEASE) di TINGKAT ATAS
// sebuah file SQL. Dipakai scripts/apply-migration.mjs (--atomic) dan scripts/test-rbac-tahap0.mjs
// agar file migrasi tidak mengacaukan transaksi pembungkus.

/** Hapus komentar, isi string dan isi dollar-quote ($$..$$ / $tag$..$tag$): sisa = pernyataan tingkat atas. */
export function pernyataanTingkatAtas(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
    .replace(/(\$[A-Za-z_]*\$)[\s\S]*?\1/g, '')
    .replace(/'(?:[^']|'')*'/g, "''");
}

// END tingkat atas = transaksi; `END IF`/`END LOOP` hanya muncul di dalam badan fungsi (sudah dibuang).
const KONTROL_TRANSAKSI =
  /(^|;)\s*(BEGIN\s*(;|TRANSACTION|WORK|ISOLATION|READ|$)|START\s+TRANSACTION|COMMIT\b|END\s*(;|TRANSACTION|WORK|$)|ROLLBACK\b|SAVEPOINT\b|RELEASE\b)/i;

/** true bila ada kontrol transaksi tingkat atas. */
export function mengandungKontrolTransaksi(sql) {
  return KONTROL_TRANSAKSI.test(pernyataanTingkatAtas(sql));
}

// N6: berkas yang mengubah policy/fungsi (tidak aman dijalankan per-statement tanpa transaksi).
const UBAH_POLICY_FUNGSI =
  /\b(?:CREATE|DROP|ALTER)\s+POLICY\b|\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b|\bDROP\s+FUNCTION\b/i;

/** true bila berkas memuat CREATE/DROP/ALTER POLICY atau CREATE [OR REPLACE] / DROP FUNCTION (di luar komentar/string). */
export function mengubahPolicyAtauFungsi(sql) {
  return UBAH_POLICY_FUNGSI.test(pernyataanTingkatAtas(sql));
}
