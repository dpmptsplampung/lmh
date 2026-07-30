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
for (const [label, q] of [
  ['tabel', "SELECT table_name FROM information_schema.tables WHERE table_name IN ('pengaduan','pengaduan_riwayat','hari_libur') ORDER BY table_name"],
  ['fungsi', "SELECT proname FROM pg_proc WHERE proname IN ('tambah_hari_kerja','generate_nomor_tiket','buat_pengaduan','lacak_pengaduan','eskalasi_pengaduan_lewat_batas') ORDER BY proname"],
  ['cron', "SELECT jobname FROM cron.job WHERE jobname='pengaduan_eskalasi'"],
]) {
  const { data, error } = await s.rpc('exec_query', { q });
  console.log(label + ':', error ? ('ERR ' + error.message) : JSON.stringify(data));
}

// 2) Buat pengaduan uji jalur layanan (dengan kontak) — verifikasi SLA & tiket acak.
const buat = await s.rpc('buat_pengaduan', { p_jalur: 'layanan', p_isi: 'Uji kanal pengaduan', p_kontak: 'selftest@example.invalid', p_layanan_id: null, p_anonim: false, p_sesi_chat_id: null });
console.log('buat pengaduan:', buat.error ? ('ERR ' + buat.error.message) : JSON.stringify(buat.data));
const tiket = Array.isArray(buat.data) ? buat.data[0]?.nomor_tiket : buat.data?.nomor_tiket;

// 3) Verifikasi SLA = hari kerja (bukan kalender) & format tiket.
if (tiket) {
  const detail = await s.rpc('exec_query', { q: `SELECT nomor_tiket, batas_verifikasi, batas_penanganan, status FROM public.pengaduan WHERE nomor_tiket='${tiket}'` });
  console.log('detail (tiket P+6acak, SLA hari kerja):', JSON.stringify(detail.data ?? detail.error));
  // Lacak dengan tiket+kontak (SK-25).
  const lacak = await s.rpc('lacak_pengaduan', { p_tiket: tiket, p_kontak: 'selftest@example.invalid' });
  console.log('lacak (harus ketemu):', lacak.error ? ('ERR ' + lacak.error.message) : JSON.stringify(lacak.data));
  const lacakSalah = await s.rpc('lacak_pengaduan', { p_tiket: tiket, p_kontak: 'salah@example.invalid' });
  console.log('lacak kontak salah (harus kosong):', JSON.stringify(lacakSalah.data ?? []));
}

// 4) Buat pengaduan jalur INTEGRITAS (anonim) — verifikasi RLS I-15.
const buatInt = await s.rpc('buat_pengaduan', { p_jalur: 'integritas', p_isi: 'Uji pengaduan integritas (rahasia)', p_kontak: null, p_layanan_id: null, p_anonim: true, p_sesi_chat_id: null });
console.log('buat integritas:', buatInt.error ? ('ERR ' + buatInt.error.message) : 'OK');

// 5) BERSIHKAN semua pengaduan uji.
const bersih = await s.rpc('exec_sql', { q: "DELETE FROM public.pengaduan WHERE isi LIKE 'Uji kanal pengaduan%' OR isi LIKE 'Uji pengaduan integritas%'" });
console.log('bersih-bersih:', bersih.error ? 'ERR' : 'OK');
const akhir = await s.rpc('exec_query', { q: "SELECT count(*)::int AS n FROM public.pengaduan" });
console.log('pengaduan akhir:', JSON.stringify(akhir.data ?? akhir.error));
