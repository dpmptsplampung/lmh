// Skrip READ-ONLY untuk fase A (inventarisasi kode) — introspeksi skema Supabase live.
// Tidak mengubah data apa pun. Hanya SELECT dari tabel katalog PostgreSQL.
// Jalankan: node scripts/introspect-schema.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// Baca .env.local secara manual (tanpa dependensi dotenv)
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

async function query(label, sql) {
  const { data, error } = await supabase.rpc('exec_readonly_query', { q: sql }).maybeSingle();
  if (error && !/exec_readonly_query/.test(error.message ?? '')) {
    return { label, error: error.message };
  }
  if (error) return { label, unsupported: true };
  return { label, data };
}

// Helper utama: pakai PostgREST untuk tabel yang bisa diakses service role,
// dan SQL lewat RPC untuk katalog. Jika RPC tidak tersedia, fallback ke daftar tabel
// dari PostgREST OpenAPI root.
async function main() {
  const out = { waktu_ambil: new Date().toISOString(), catatan: 'read-only introspection untuk fase A' };

  // 1. Daftar tabel + kolom dari PostgREST root definition
  const rootRes = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const openapi = await rootRes.json();
  out.tabel_dari_postgrest = Object.keys(openapi.definitions ?? {}).sort();
  out.kolom_per_tabel = Object.fromEntries(
    Object.entries(openapi.definitions ?? {}).map(([t, def]) => [
      t,
      Object.entries(def.properties ?? {}).map(([kolom, meta]) => ({
        kolom,
        tipe: meta.format ?? meta.type,
        deskripsi: meta.description ?? null,
        enum: meta.enum ?? null,
      })),
    ]),
  );

  // 2. Daftar RPC (fungsi) dari paths
  out.rpc_dari_postgrest = Object.keys(openapi.paths ?? {})
    .filter((p) => p.startsWith('/rpc/'))
    .map((p) => p.replace('/rpc/', ''))
    .sort();

  // 3. Isi tabel kunci untuk verifikasi fase A (jumlah kecil, read-only)
  const tabelIsi = ['layanan', 'layanan_jadwal', 'layanan_libur', 'petugas'];
  out.isi = {};
  for (const t of tabelIsi) {
    const { data, error, count } = await supabase.from(t).select('*', { count: 'exact' }).limit(100);
    out.isi[t] = error ? { error: error.message } : { count, rows: data };
  }

  // 4. Cek kolom spesifik yang dipersoalkan spec
  const cekKolom = [
    ['visit', 'id, asal, tujuan, status, tanggal_rencana, waktu_masuk'],
    ['faq_knowledge_base', 'id, pertanyaan, updated_at'],
    ['absensi_petugas', 'id, petugas_id, tanggal, jam_masuk, jam_pulang, status'],
    ['listing_umkm', 'id, nama_umkm, status, updated_at'],
  ];
  out.sampel = {};
  for (const [t, koloms] of cekKolom) {
    const { data, error, count } = await supabase.from(t).select(koloms, { count: 'exact' }).limit(5);
    out.sampel[t] = error ? { error: error.message } : { count, contoh: data };
  }

  // 5. Distribusi nilai status (untuk membuktikan enum nyata yang dipakai data)
  const distQuery = [
    ['visit_status', 'visit', 'status'],
    ['visit_tujuan', 'visit', 'tujuan'],
    ['layanan_tipe', 'layanan', 'tipe'],
    ['petugas_role', 'petugas', 'role'],
    ['absensi_status', 'absensi_petugas', 'status'],
    ['listing_status', 'listing_umkm', 'status'],
  ];
  out.distribusi = {};
  for (const [label, tabel, kolom] of distQuery) {
    const { data, error } = await supabase.from(tabel).select(kolom).limit(5000);
    if (error) {
      out.distribusi[label] = { error: error.message };
    } else {
      const freq = {};
      for (const row of data ?? []) freq[row[kolom]] = (freq[row[kolom]] ?? 0) + 1;
      out.distribusi[label] = freq;
    }
  }

  const outPath = join(root, 'docs', 'analysis', 'schema-live-snapshot.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`Tersimpan: ${outPath}`);
  console.log(`Tabel terdeteksi: ${out.tabel_dari_postgrest.length}`);
  console.log(`RPC terdeteksi: ${out.rpc_dari_postgrest.length}`);
}

main().catch((e) => {
  console.error('Gagal:', e);
  process.exit(1);
});
