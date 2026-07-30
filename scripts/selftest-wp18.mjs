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
const obj = await s.rpc('exec_query', { q: "SELECT proname FROM pg_proc WHERE proname IN ('email_layanan','jumlah_terdaftar','kirim_pengingat_petugas','metrik_kepatuhan') ORDER BY proname" });
console.log('fungsi:', JSON.stringify(obj.data ?? obj.error));
const cron = await s.rpc('exec_query', { q: "SELECT jobname FROM cron.job WHERE jobname IN ('notif_h1_sore','notif_h0_pagi','notif_eskalasi') ORDER BY jobname" });
console.log('cron:', JSON.stringify(cron.data ?? cron.error));

// 2) Uji NOT-02: tanpa yang terdaftar, tidak ada email yang dikirim.
const lay = await s.rpc('exec_query', { q: "SELECT id, nama FROM public.layanan ORDER BY nama LIMIT 1" });
const layanan = lay.data[0];
// Daftarkan kontak PIC untuk layanan ini (uji; akan dibersihkan).
await s.rpc('exec_sql', { q: `INSERT INTO public.layanan_kontak (layanan_id, email, peran, aktif) VALUES ('${layanan.id}','selftest@example.invalid','pic',true)` });
// Panggil pengingat untuk tanggal tanpa pendaftar -> harus 0 email.
const tgl = '2099-06-15';
const kirim = await s.rpc('kirim_pengingat_petugas', { p_jenis: 'h1', p_tanggal: tgl });
console.log(`kirim_pengingat(h1, ${tgl}) tanpa pendaftar (harus 0):`, kirim.error ? ('ERR ' + kirim.error.message) : JSON.stringify(kirim.data));
// Verifikasi tidak ada notifikasi selftest yang ter-enqueue.
const notif = await s.rpc('exec_query', { q: "SELECT count(*)::int AS n FROM public.notifikasi WHERE tujuan_email='selftest@example.invalid'" });
console.log('notifikasi selftest (harus 0, NOT-02 syarat ke-3):', JSON.stringify(notif.data ?? notif.error));

// 3) Uji metrik_kepatuhan mengembalikan baris (struktur benar).
const metrik = await s.rpc('metrik_kepatuhan', { p_layanan_id: layanan.id, p_awal: '2026-07-01', p_akhir: '2026-07-29' });
console.log('metrik_kepatuhan (struktur):', metrik.error ? ('ERR ' + metrik.error.message) : JSON.stringify(metrik.data));

// 4) BERSIHKAN kontak uji.
await s.rpc('exec_sql', { q: `DELETE FROM public.layanan_kontak WHERE email='selftest@example.invalid'` });
console.log('bersih-bersih kontak: OK');
