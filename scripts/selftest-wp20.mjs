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

// 1) Struktur ada & KOSONG (Langkah 1).
const k = await s.rpc('exec_query', { q: "SELECT count(*)::int AS n FROM public.kunjungan" });
const t = await s.rpc('exec_query', { q: "SELECT count(*)::int AS n FROM public.tiket_antrean" });
console.log('kunjungan (harus 0):', JSON.stringify(k.data));
console.log('tiket_antrean (harus 0):', JSON.stringify(t.data));

// 2) Kolom layanan baru ada.
const kolom = await s.rpc('exec_query', { q: "SELECT column_name FROM information_schema.columns WHERE table_name='layanan' AND column_name IN ('penyerta','status_tampilan','punya_antrean','batas_ambil_nomor_menit','kuota_harian') ORDER BY column_name" });
console.log('kolom layanan:', JSON.stringify(kolom.data));

// 3) Fungsi terbit_tiket ada & unik constraint.
const fn = await s.rpc('exec_query', { q: "SELECT proname FROM pg_proc WHERE proname='terbit_tiket'" });
console.log('fungsi terbit_tiket:', JSON.stringify(fn.data));
const unik = await s.rpc('exec_query', { q: "SELECT conname FROM pg_constraint WHERE conrelid='public.tiket_antrean'::regclass AND contype='u'" });
console.log('unique constraint tiket:', JSON.stringify(unik.data));

// 4) Uji terbit_tiket: buat kunjungan dummy + 2 tiket, verifikasi nomor unik & display.
//    (Dummy di tanggal jauh agar tidak bentrok; dibersihkan setelahnya.)
const lay = await s.rpc('exec_query', { q: "SELECT id, nama, prefiks_antrean FROM public.layanan ORDER BY nama LIMIT 2" });
const layanan = lay.data;
const tgl = '2099-12-31';
const _mk = await s.rpc('exec_sql', { q: `INSERT INTO public.kunjungan (nama, asal, tanggal, status) VALUES ('_SELFTEST_','walk_in','${tgl}','menunggu')` });
const kid = (await s.rpc('exec_query', { q: `SELECT id FROM public.kunjungan WHERE nama='_SELFTEST_' AND tanggal='${tgl}' ORDER BY created_at DESC LIMIT 1` })).data[0].id;
const _t1 = await s.rpc('terbit_tiket', { p_kunjungan_id: kid, p_layanan_id: layanan[0].id });
const _t2 = await s.rpc('terbit_tiket', { p_kunjungan_id: kid, p_layanan_id: layanan[0].id });
const tikets = await s.rpc('exec_query', { q: `SELECT nomor, nomor_display FROM public.tiket_antrean WHERE kunjungan_id='${kid}' ORDER BY nomor` });
console.log('2 tiket untuk 1 kunjungan (nomor harus 1,2 & display berprefiks):', JSON.stringify(tikets.data ?? tikets.error));

// 5) BERSIHKAN dummy (tiket cascade saat kunjungan dihapus).
await s.rpc('exec_sql', { q: `DELETE FROM public.kunjungan WHERE nama='_SELFTEST_'` });
await s.rpc('exec_sql', { q: `DELETE FROM public.antrean_counter WHERE tanggal='${tgl}'` });
console.log('bersih-bersih dummy: OK');
