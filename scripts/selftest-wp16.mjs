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

// 1) Backfill: setiap layanan aktif punya jadwal_standby (10 layanan x 5 hari = 50 baris).
const cnt = await s.rpc('exec_query', { q: "SELECT count(*)::int AS n FROM public.jadwal_standby" });
console.log('jadwal_standby baris:', JSON.stringify(cnt.data ?? cnt.error));

// 2) Jam selesai maksimal harus 15:30 (OQ-04).
const jam = await s.rpc('exec_query', { q: "SELECT DISTINCT jam_selesai FROM public.jadwal_standby ORDER BY jam_selesai" });
console.log('jam_selesai unik:', JSON.stringify(jam.data ?? jam.error));

// 3) jadwal_berikutnya untuk satu layanan (harus mengembalikan hari kerja terdekat).
const lay = await s.rpc('exec_query', { q: "SELECT id, nama FROM public.layanan ORDER BY nama LIMIT 1" });
const layanan = lay.data[0];
const next = await s.rpc('exec_query', { q: `SELECT public.jadwal_berikutnya('${layanan.id}', '2099-06-14'::date) AS t` }); // 2099-06-14 = Minggu
console.log(`jadwal_berikutnya(${layanan.nama}, dari Minggu 2099-06-14):`, JSON.stringify(next.data ?? next.error));

// 4) is_layanan_buka_jadwal: Senin=true, Minggu=false, jam 16:00=false (di luar 15:30).
const tes = await s.rpc('exec_query', { q: `SELECT
  public.is_layanan_buka_jadwal('${layanan.id}', '2099-06-15'::date, NULL) AS senin,
  public.is_layanan_buka_jadwal('${layanan.id}', '2099-06-14'::date, NULL) AS minggu,
  public.is_layanan_buka_jadwal('${layanan.id}', '2099-06-15'::date, '10:00'::time) AS jam10,
  public.is_layanan_buka_jadwal('${layanan.id}', '2099-06-15'::date, '16:00'::time) AS jam16` });
console.log('is_buka (senin=true, minggu=false, jam10=true, jam16=false):', JSON.stringify(tes.data ?? tes.error));
