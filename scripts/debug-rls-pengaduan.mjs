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
const p = await s.rpc('exec_query', { q: "SELECT polname, polpermissive, pg_get_expr(polqual, polrelid) AS qual FROM pg_policy pol JOIN pg_class c ON c.oid=pol.polrelid WHERE c.relname='pengaduan' AND pol.polcmd='r' ORDER BY polname" });
console.log('policy SELECT pengaduan:', JSON.stringify(p.data, null, 1));
const all = await s.rpc('exec_query', { q: "SELECT count(*)::int AS n FROM pg_policy pol JOIN pg_class c ON c.oid=pol.polrelid WHERE c.relname='pengaduan'" });
console.log('total policy pengaduan:', JSON.stringify(all.data));
