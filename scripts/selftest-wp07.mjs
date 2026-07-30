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
const tgl = '2099-06-15';

// 1) Bekukan.
const bekuk = await s.rpc('bekukan_jadwal', { p_tanggal: tgl });
console.log('bekukan:', bekuk.error ? ('ERR ' + bekuk.error.message) : ('baris=' + JSON.stringify(bekuk.data)));

// 2) I-08: UPDATE langsung harus DITOLAK trigger.
const upd = await s.rpc('exec_sql', { q: `UPDATE public.jadwal_harian_beku SET seharusnya_standby=false WHERE tanggal='${tgl}'` });
console.log('UPDATE tanpa izin (harus ERR):', upd.error ? ('OK ditolak: ' + upd.error.message.slice(0, 60)) : 'GAGAL: diterima');

// 3) DELETE langsung harus DITOLAK trigger.
const delNo = await s.rpc('exec_sql', { q: `DELETE FROM public.jadwal_harian_beku WHERE tanggal='${tgl}'` });
console.log('DELETE tanpa izin (harus ERR):', delNo.error ? ('OK ditolak: ' + delNo.error.message.slice(0, 60)) : 'GAGAL: diterima');

// 4) Nilai masih utuh.
const utuh = await s.rpc('exec_query', { q: `SELECT count(*)::int AS n, bool_and(seharusnya_standby) AS semua_true FROM public.jadwal_harian_beku WHERE tanggal='${tgl}'` });
console.log('nilai utuh (n=10, semua_true=true):', JSON.stringify(utuh.data ?? utuh.error));

// 5) Bersih-bersih DENGAN izin maintenance (SET app.jhb_allow='on' dalam satu sesi/transaksi).
const allow = await s.rpc('exec_sql', { q: `BEGIN; SET LOCAL app.jhb_allow='on'; DELETE FROM public.jadwal_harian_beku WHERE tanggal='${tgl}'; COMMIT;` });
console.log('bersih-bersih (dengan izin):', allow.error ? ('ERR ' + allow.error.message) : 'OK');
const akhir = await s.rpc('exec_query', { q: `SELECT count(*)::int AS n FROM public.jadwal_harian_beku WHERE tanggal='${tgl}'` });
console.log('baris uji akhir (harus 0):', JSON.stringify(akhir.data ?? akhir.error));
