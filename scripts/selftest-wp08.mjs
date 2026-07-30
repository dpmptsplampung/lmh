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

// 1) Objek ada.
const obj = await s.rpc('exec_query', { q: "SELECT proname FROM pg_proc WHERE proname IN ('skm_rr_tambah','trg_visit_selesai_rr','trg_skm_insert_rr') ORDER BY proname" });
console.log('fungsi:', JSON.stringify(obj.data ?? obj.error));
const trig = await s.rpc('exec_query', { q: "SELECT tgname FROM pg_trigger WHERE tgname IN ('trg_visit_selesai_rr','trg_skm_insert_rr') ORDER BY tgname" });
console.log('trigger:', JSON.stringify(trig.data ?? trig.error));

// 2) Uji skm_rr_tambah menambah hitungan (pada layanan nyata, tanggal hari ini WIB).
const lay = await s.rpc('exec_query', { q: "SELECT id FROM public.layanan ORDER BY nama LIMIT 1" });
const layananId = lay.data[0].id;
const tambah = await s.rpc('skm_rr_tambah', { p_layanan_id: layananId, p_field: 'dilayani' });
console.log('skm_rr_tambah dilayani:', tambah.error ? ('ERR ' + tambah.error.message) : 'OK');
const tambah2 = await s.rpc('skm_rr_tambah', { p_layanan_id: layananId, p_field: 'mengisi' });
console.log('skm_rr_tambah mengisi:', tambah2.error ? ('ERR ' + tambah2.error.message) : 'OK');

const cek = await s.rpc('exec_query', { q: `SELECT dilayani, mengisi FROM public.skm_response_rate WHERE layanan_id='${layananId}' ORDER BY tanggal DESC LIMIT 1` });
console.log('hitungan (dilayani>=1, mengisi>=1):', JSON.stringify(cek.data ?? cek.error));

// 3) BERSIHKAN baris uji (kurangi kembali agar tidak mengotori data nyata).
const bersih = await s.rpc('exec_sql', { q: `UPDATE public.skm_response_rate SET dilayani = GREATEST(dilayani-1,0), mengisi = GREATEST(mengisi-1,0) WHERE layanan_id='${layananId}'` });
console.log('bersih-bersih:', bersih.error ? 'ERR' : 'OK');
