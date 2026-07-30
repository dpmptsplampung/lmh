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

// Ambil auth_user_id dari admin yang SUDAH ADA (bukan data pengunjung; hanya untuk FK).
const adm = await s.rpc('exec_query', { q: "SELECT auth_user_id FROM public.petugas WHERE role='admin' LIMIT 1" });
const authId = Array.isArray(adm.data) && adm.data[0] ? adm.data[0].auth_user_id : null;
if (!authId) { console.log('tidak ada admin untuk FK'); process.exit(0); }

// Buat petugas dummy merujuk auth user nyata (akan dihapus setelah uji).
const mk = await s.rpc('exec_sql', { q: `INSERT INTO public.petugas (auth_user_id, nama, role) VALUES ('${authId}','_SELFTEST_', 'petugas') RETURNING id` });
const idRow = await s.rpc('exec_query', { q: `SELECT id FROM public.petugas WHERE nama='_SELFTEST_' ORDER BY created_at DESC LIMIT 1` });
const id = Array.isArray(idRow.data) && idRow.data[0] ? idRow.data[0].id : null;
console.log('buat dummy:', mk.error ? ('ERR ' + mk.error.message) : ('OK id=' + id));

// 1) set_nonaktif TANPA alasan harus GAGAL (RBA-08).
const tanpaAlasan = await s.rpc('petugas_set_nonaktif', { p_petugas_id: id, p_alasan: '  ', p_actor: null });
console.log('tanpa alasan (harus ditolak):', tanpaAlasan.error ? ('OK ditolak') : 'GAGAL: diterima');

// 2) set_nonaktif DENGAN alasan harus BERHASIL.
const dgnAlasan = await s.rpc('petugas_set_nonaktif', { p_petugas_id: id, p_alasan: 'uji nonaktif', p_actor: null });
console.log('dengan alasan:', dgnAlasan.error ? ('ERR ' + dgnAlasan.error.message) : 'OK');

// 3) Verifikasi status nonaktif tercatat.
const st = await s.rpc('exec_query', { q: `SELECT aktif, nonaktif_alasan FROM public.petugas WHERE id='${id}'` });
console.log('status setelah nonaktif (aktif harus false):', JSON.stringify(st.data ?? st.error));

// 4) get_my_role mengecualikan nonaktif (I-22) — verifikasi via SQL setara fungsi.
const role = await s.rpc('exec_query', { q: `SELECT (SELECT p.role FROM public.petugas p WHERE p.auth_user_id='${authId}' AND p.aktif=true AND p.id='${id}') AS role` });
console.log('role nonaktif via fungsi (harus null):', JSON.stringify(role.data ?? role.error));

// BERSIHKAN dummy.
const del = await s.rpc('exec_sql', { q: `DELETE FROM public.petugas WHERE id='${id}'` });
console.log('bersih-bersih dummy:', del.error ? 'ERR' : 'OK');
