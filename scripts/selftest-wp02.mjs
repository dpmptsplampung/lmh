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

// 1) Uji log_error_event menulis 1 baris.
const ins = await s.rpc('log_error_event', {
  p_level: 'error', p_route: '/api/_selftest', p_method: 'GET',
  p_operation: 'selftest.wp02', p_request_id: 'selftest-1', p_status_code: 500,
  p_message: '[SelfTest]', p_detail: { selftest: true }, p_environment: 'production', p_version: '2.1.0',
});
console.log('insert log_error_event:', ins.error ? ('ERR ' + ins.error.message) : 'OK');

// 2) Verifikasi baris masuk.
const read = await s.rpc('exec_query', { q: "SELECT count(*)::int AS n FROM public.error_log WHERE operation='selftest.wp02'" });
console.log('baris selftest:', JSON.stringify(read.data ?? read.error));

// 3) Uji check_error_alert dengan ambang 1 (harus enqueue notifikasi).
const alert = await s.rpc('check_error_alert', { p_window_minutes: 60, p_threshold: 1, p_recipient: 'selftest@example.invalid' });
console.log('check_error_alert:', alert.error ? ('ERR ' + alert.error.message) : ('returned ' + JSON.stringify(alert.data)));

// 4) Verifikasi notifikasi ter-enqueue (idempoten).
const notif = await s.rpc('exec_query', { q: "SELECT idempotency_key, status FROM public.notifikasi WHERE idempotency_key LIKE 'error_alert:%' ORDER BY created_at DESC LIMIT 1" });
console.log('notifikasi alert:', JSON.stringify(notif.data ?? notif.error));

// 5) BERSIHKAN baris uji agar DB kembali bersih (hanya baris selftest, bukan data pengunjung).
const del = await s.rpc('exec_sql', { q: "DELETE FROM public.error_log WHERE operation='selftest.wp02'" });
const deln = await s.rpc('exec_sql', { q: "DELETE FROM public.notifikasi WHERE idempotency_key LIKE 'error_alert:%' AND tujuan_email='selftest@example.invalid'" });
console.log('bersih-bersih:', (del.error ? 'ERR' : 'OK') + ' / ' + (deln.error ? 'ERR' : 'OK'));
const finalCount = await s.rpc('exec_query', { q: "SELECT count(*)::int AS n FROM public.error_log" });
console.log('error_log akhir:', JSON.stringify(finalCount.data ?? finalCount.error));
