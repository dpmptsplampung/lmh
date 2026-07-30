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
const q1 = "SELECT count(*)::int AS n FROM public.error_log";
const q2 = "SELECT proname FROM pg_proc WHERE proname IN ('log_error_event','check_error_alert','exec_query') ORDER BY proname";
const q3 = "SELECT jobname, schedule FROM cron.job WHERE jobname='observability_error_alert'";
const q4 = "SELECT pol.polname FROM pg_policy pol JOIN pg_class c ON c.oid=pol.polrelid WHERE c.relname='error_log'";
for (const [label, q] of [['error_log', q1], ['fungsi', q2], ['cron', q3], ['policy', q4]]) {
  const { data, error } = await s.rpc('exec_query', { q });
  console.log(label + ':', error ? ('ERR ' + error.message) : JSON.stringify(data));
}
