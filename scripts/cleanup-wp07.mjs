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
// Bersih-bersih baris uji: buat fungsi sementara yang mengatur app.jhb_allow lalu hapus,
// semua dalam SATU EXECUTE (satu sesi) agar SET berlaku untuk DELETE berikutnya.
const sql = `
DO $$
BEGIN
  PERFORM set_config('app.jhb_allow', 'on', false);
  DELETE FROM public.jadwal_harian_beku WHERE tanggal = '${tgl}';
END $$;
`;
const res = await s.rpc('exec_sql', { q: sql });
console.log('bersih-bersih (DO block):', res.error ? ('ERR ' + res.error.message) : 'OK');
const akhir = await s.rpc('exec_query', { q: `SELECT count(*)::int AS n FROM public.jadwal_harian_beku WHERE tanggal='${tgl}'` });
console.log('baris uji akhir (harus 0):', JSON.stringify(akhir.data ?? akhir.error));
