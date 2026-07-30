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

// Ambil 1 FAQ yang ada (bukan data pengunjung).
const faq = await s.rpc('exec_query', { q: "SELECT id, jawaban, perlu_embed_ulang FROM public.faq_knowledge_base ORDER BY created_at LIMIT 1" });
const row = Array.isArray(faq.data) ? faq.data[0] : null;
if (!row) { console.log('tidak ada FAQ untuk diuji'); process.exit(0); }
console.log('FAQ sebelum:', JSON.stringify(row));

// Update jawaban (tambah spasi) -> trigger harus set perlu_embed_ulang=true.
const upd = await s.rpc('exec_sql', { q: `UPDATE public.faq_knowledge_base SET jawaban = jawaban || ' ' WHERE id = '${row.id}'` });
console.log('update jawaban:', upd.error ? ('ERR ' + upd.error.message) : 'OK');

const after = await s.rpc('exec_query', { q: `SELECT id, perlu_embed_ulang FROM public.faq_knowledge_base WHERE id = '${row.id}'` });
console.log('FAQ sesudah (perlu_embed_ulang harus true):', JSON.stringify(after.data ?? after.error));

// Kembalikan jawaban ke semula (bersih-bersih).
const restore = await s.rpc('exec_sql', { q: `UPDATE public.faq_knowledge_base SET jawaban = '${String(row.jawaban).replace(/'/g, "''")}', perlu_embed_ulang = ${row.perlu_embed_ulang} WHERE id = '${row.id}'` });
console.log('restore:', restore.error ? ('ERR ' + restore.error.message) : 'OK (dikembalikan)');
