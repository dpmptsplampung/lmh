// Skrip READ-ONLY: enumerasi kunjungan/tiket yang "mencurigakan" di database produksi.
// TIDAK mengubah data apa pun. Hanya SELECT.
// Kategori yang ditampilkan:
//   A. QR sudah dibuat tapi pengunjung belum datang (kadaluarsa tanggal)
//   B. Registrasi ada tapi belum selesai layanannya (kadaluarsa tanggal)
//   C. Status sudah final tapi di tanggal lampau (untuk visibilitas)
//
// Jalankan: node scripts/inspect-stale-queue.mjs

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const envText = readFileSync(join(root, '.env.local'), 'utf8');
const env = Object.fromEntries(
  envText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    }),
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY tidak ditemukan di .env.local');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

function _fmt(date) {
  if (!date) return '—';
  return new Date(date).toISOString().slice(0, 16).replace('T', ' ');
}

function row(label, rows) {
  console.log(`\n=== ${label} (${rows.length} baris) ===`);
  if (rows.length === 0) {
    console.log('  (tidak ada)');
    return;
  }
  // cetak ringkas
  for (const r of rows) {
    console.log(
      `  - ${r.tanggal} | ${r.nama ?? '(tanpa nama)'} | qr=${r.qr_token ? 'ADA' : 'TIDAK'} | status=${r.status} | kunjungan=${r.id} | tiket=${r.tiket_id ?? '—'} | layanan=${r.layanan ?? '—'} | nomor=${r.nomor_display ?? '—'}`,
    );
  }
}

async function main() {
  const todayWIB = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  console.log(`Tanggal referensi (WIB): ${todayWIB}`);
  console.log(`URL Supabase: ${url.replace(/\/\/.*@/, '//<redacted>@')}`);

  // Tarik semua kunjungan di luar hari ini + hari ini (sebagai pembanding)
  const { data, error } = await supabase
    .from('kunjungan')
    .select(`
      id, nama, kontak_hp, asal, qr_token, tanggal, status,
      waktu_masuk, created_at,
      tiket_antrean (
        id, layanan_id, tanggal, nomor, nomor_display, status,
        waktu_terbit, waktu_mulai_layan, waktu_selesai,
        layanan:layanan_id ( nama )
      )
    `)
    .order('tanggal', { ascending: false });

  if (error) {
    console.error('Gagal query:', error.message);
    process.exit(1);
  }

  const all = (data ?? []).map((k) => {
    const t = Array.isArray(k.tiket_antrean) ? k.tiket_antrean[0] : k.tiket_antrean;
    const layanan = t?.layanan
      ? (Array.isArray(t.layanan) ? t.layanan[0]?.nama : t.layanan?.nama)
      : null;
    return {
      id: k.id,
      nama: k.nama,
      tanggal: k.tanggal,
      qr_token: k.qr_token,
      status: k.status,
      tiket_id: t?.id ?? null,
      nomor_display: t?.nomor_display ?? null,
      layanan,
      tiket_status: t?.status ?? null,
    };
  });

  // Kategori A: QR dibuat, status menunggu/terjadwal, tanggal < hari ini
  const A = all.filter(
    (k) => k.qr_token && (k.status === 'menunggu' || k.status === 'terjadwal') && k.tanggal < todayWIB,
  );
  row('A. QR dibuat, belum datang, tanggal SUDAH LEWAT', A);

  // Kategori A2: QR dibuat, status menunggu/terjadwal, hari ini (visibilitas)
  const A2 = all.filter(
    (k) => k.qr_token && (k.status === 'menunggu' || k.status === 'terjadwal') && k.tanggal === todayWIB,
  );
  row('A2. QR dibuat, belum datang, hari ini (jangan dihapus)', A2);

  // Kategori B: tanggal < hari ini, status menunggu/dilayani (tidak final)
  const B = all.filter(
    (k) =>
      k.tanggal < todayWIB && (k.status === 'menunggu' || k.status === 'dilayani' || k.status === 'terjadwal'),
  );
  row('B. Tanggal lewat, kunjungan belum final (kandidat no_show/selesai/batal)', B);

  // Kategori C: status final tapi tanggal < hari ini (untuk ringkasan)
  const C = all.filter(
    (k) =>
      k.tanggal < todayWIB && ['selesai', 'batal', 'no_show', 'tidak_terlayani'].includes(k.status),
  );
  row('C. Tanggal lewat, SUDAH final (untuk perbandingan)', C);

  // Ringkasan total
  console.log('\n=== RINGKASAN ===');
  console.log(`Total kunjungan di database: ${all.length}`);
  console.log(`  - Hari ini:           ${all.filter((k) => k.tanggal === todayWIB).length}`);
  console.log(`  - Sebelum hari ini:   ${all.filter((k) => k.tanggal < todayWIB).length}`);
  console.log(`Kategori A (QR kadaluarsa, hapus/selesaikan): ${A.length}`);
  console.log(`Kategori A2 (QR hari ini, jangan disentuh):   ${A2.length}`);
  console.log(`Kategori B (kadaluarsa belum final):         ${B.length}`);
  console.log(`Kategori C (kadaluarsa sudah final):         ${C.length}`);

  console.log('\n=== SKRIP INI READ-ONLY. TIDAK ADA DATA YANG DIUBAH. ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
