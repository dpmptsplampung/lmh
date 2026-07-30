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
const sisa = await s.rpc('exec_query', { q: "SELECT count(*)::int AS n FROM public.petugas WHERE nama='_SELFTEST_'" });
console.log('sisa dummy _SELFTEST_:', JSON.stringify(sisa.data ?? sisa.error));
const kolom = await s.rpc('exec_query', { q: "SELECT column_name FROM information_schema.columns WHERE table_name='petugas' AND column_name IN ('aktif','nonaktif_sejak','nonaktif_oleh','nonaktif_alasan') ORDER BY column_name" });
console.log('kolom:', JSON.stringify(kolom.data ?? kolom.error));
const fn = await s.rpc('exec_query', { q: "SELECT proname FROM pg_proc WHERE proname IN ('petugas_set_nonaktif','petugas_set_aktif','get_my_role') ORDER BY proname" });
console.log('fungsi:', JSON.stringify(fn.data ?? fn.error));
const petugas = await s.rpc('exec_query', { q: "SELECT nama, role, aktif FROM public.petugas ORDER BY created_at" });
console.log('petugas nyata (aktif harus true):', JSON.stringify(petugas.data ?? petugas.error));
