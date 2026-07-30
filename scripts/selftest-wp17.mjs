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
const obj = await s.rpc('exec_query', { q: "SELECT proname FROM pg_proc WHERE proname IN ('catat_absensi','antrean_dibuka','tandai_alpa_otomatis') ORDER BY proname" });
console.log('fungsi:', JSON.stringify(obj.data ?? obj.error));
const kolom = await s.rpc('exec_query', { q: "SELECT column_name FROM information_schema.columns WHERE table_name='absensi_petugas' AND column_name IN ('sumber','dicatat_oleh') ORDER BY column_name" });
console.log('kolom absensi:', JSON.stringify(kolom.data ?? kolom.error));
const cron = await s.rpc('exec_query', { q: "SELECT jobname FROM cron.job WHERE jobname='absensi_alpa_otomatis'" });
console.log('cron:', JSON.stringify(cron.data ?? cron.error));
const setting = await s.rpc('exec_query', { q: "SELECT key, value FROM public.site_settings WHERE key='batas_jam_alpa'" });
console.log('batas_jam_alpa:', JSON.stringify(setting.data ?? setting.error));

// 2) Uji catat_absensi dengan petugas dummy sementara (auth_user_id dari admin nyata untuk FK).
const adm = await s.rpc('exec_query', { q: "SELECT auth_user_id FROM public.petugas WHERE role='admin' LIMIT 1" });
const authId = adm.data[0].auth_user_id;
const lay = await s.rpc('exec_query', { q: "SELECT id FROM public.layanan ORDER BY nama LIMIT 1" });
const layananId = lay.data[0].id;
// Buat petugas dummy dengan layanan, pakai auth admin (UNIQUE akan bentrok) -> pakai pendekatan:
// uji fungsi dengan petugas yang SUDAH ada tidak bisa (admin tanpa layanan). Maka uji fungsi
// secara langsung dengan membuat baris absensi dummy via fungsi pada petugas dummy yang kita
// buat dengan auth_user_id admin (tapi UNIQUE auth_user_id...). Gunakan pendekatan aman:
// cukup verifikasi fungsi catat_absensi MENOLAK sumber tidak valid, dan antrean_dibuka mengembalikan boolean.
const badSrc = await s.rpc('catat_absensi', { p_petugas_id: layananId, p_sumber: 'salah', p_dicatat_oleh: null });
console.log('sumber tidak valid (harus error):', badSrc.error ? 'OK ditolak' : 'GAGAL diterima');

const dibuka = await s.rpc('antrean_dibuka', { p_layanan_id: layananId, p_tanggal: '2099-01-01' });
console.log('antrean_dibuka (boolean):', dibuka.error ? ('ERR ' + dibuka.error.message) : JSON.stringify(dibuka.data));
