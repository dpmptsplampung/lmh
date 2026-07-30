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
for (const [label, q] of [
  ['kolom faq', "SELECT column_name FROM information_schema.columns WHERE table_name='faq_knowledge_base' AND column_name IN ('perlu_embed_ulang','embedding_updated_at','diubah_oleh') ORDER BY column_name"],
  ['fungsi', "SELECT proname FROM pg_proc WHERE proname IN ('faq_mark_reembed','faq_embedding_selesai') ORDER BY proname"],
  ['trigger', "SELECT tgname FROM pg_trigger WHERE tgname='trg_faq_reembed'"],
]) {
  const { data, error } = await s.rpc('exec_query', { q });
  console.log(label + ':', error ? ('ERR ' + error.message) : JSON.stringify(data));
}
