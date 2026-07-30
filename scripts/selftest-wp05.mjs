import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(root, '.env.local'), 'utf8').split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const s = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Ambil satu layanan nyata untuk uji (bukan data pengunjung).
const lay = await s.rpc('exec_query', { q: "SELECT id, nama FROM public.layanan ORDER BY nama LIMIT 1" });
const layanan = Array.isArray(lay.data) ? lay.data[0] : null;
if (!layanan) { console.log('tidak ada layanan'); process.exit(0); }
const tanggal = '2099-01-01'; // tanggal uji jauh di masa depan agar tidak bentrok data nyata

// SK-06: jalankan N panggilan bersamaan.
const N = 8;
const calls = Array.from({ length: N }, () =>
  s.rpc('terbit_nomor_antrean', { p_layanan_id: layanan.id, p_tanggal: tanggal }),
);
const results = await Promise.all(calls);
const nomors = results.map((r) => r.data).filter((n) => typeof n === 'number');
const unik = new Set(nomors);
console.log(`layanan: ${layanan.nama}`);
console.log(`nomor diterbitkan: ${JSON.stringify(nomors)}`);
console.log(`unik: ${unik.size} dari ${nomors.length} -> ${unik.size === nomors.length ? 'LOLOS (I-01)' : 'GAGAL: ada duplikat'}`);

// Verifikasi counter akhir = N.
const cek = await s.rpc('exec_query', { q: `SELECT nomor_terakhir FROM public.antrean_counter WHERE layanan_id='${layanan.id}' AND tanggal='${tanggal}'` });
console.log('counter akhir:', JSON.stringify(cek.data ?? cek.error));

// BERSIHKAN baris uji agar produksi bersih.
const del = await s.rpc('exec_sql', { q: `DELETE FROM public.antrean_counter WHERE layanan_id='${layanan.id}' AND tanggal='${tanggal}'` });
console.log('bersih-bersih:', del.error ? 'ERR' : 'OK');
