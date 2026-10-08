// Konsol Pengaturan: tes PERILAKU migrasi 202610090003. SATU transaksi yang SELALU di-ROLLBACK
// (data uji sintetis; tidak pernah COMMIT). Menerapkan berkas migrasi DI DALAM transaksi.
//   node scripts/test-konsol-pengaturan.mjs
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mengandungKontrolTransaksi } from './lib/sql-txn.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(root, '.env.local'), 'utf8').split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }),
);
if (!env.DIRECT_URL) { console.error('DIRECT_URL tidak ada di .env.local'); process.exit(2); }
const MIG = readFileSync(join(root, 'supabase/migrations/202610090003_konsol_pengaturan.sql'), 'utf8');
if (mengandungKontrolTransaksi(MIG)) { console.error('DITOLAK: migrasi memuat kontrol transaksi'); process.exit(2); }

const c = new pg.Client({ connectionString: env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
let lulus = 0; const gagal = [];
const cek = (n, ok, d = '') => { if (ok) lulus++; else gagal.push(`${n} :: ${d}`); console.log(`${ok ? 'LOLOS' : 'GAGAL'}  ${n}${!ok && d ? ' :: ' + d : ''}`); };

let spN = 0;
const POSTGRES = { dbRole: null, claims: null };
const ANON = { dbRole: 'anon', claims: { role: 'anon' } };
const AUTH = { dbRole: 'authenticated', claims: { sub: '00000000-0000-4000-8000-000000000001', role: 'authenticated' } };
const SERVICE = { dbRole: 'service_role', claims: { role: 'service_role' } };
async function run(a, sql, params = []) {
  const name = `r${++spN}`;
  await c.query(`SAVEPOINT ${name}`);
  try {
    await c.query('RESET ROLE');
    await c.query("SELECT set_config('request.jwt.claims', $1, true)", [a.claims ? JSON.stringify(a.claims) : '']);
    if (a.dbRole) await c.query(`SET LOCAL ROLE ${a.dbRole}`);
    const r = await c.query(sql, params);
    await c.query('RESET ROLE');
    await c.query(`RELEASE SAVEPOINT ${name}`);
    return { ok: true, rows: r.rows, n: r.rowCount };
  } catch (e) {
    await c.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await c.query('RESET ROLE');
    return { ok: false, code: e.code, msg: e.message };
  }
}
const pgq = (sql, p) => run(POSTGRES, sql, p);
const svc = (sql, p) => run(SERVICE, sql, p);
const ditolak = (r) => !r.ok && r.code === '42501';

const K = 'llm.rantai_chat';
const E1 = '00000000-0000-4000-8000-0000000000e1';
const E2 = '00000000-0000-4000-8000-0000000000e2';
const entri = (id, label) => ({ id, label, tipe: 'openai_compat', base_url: 'https://gw.example.com/v1', model: 'm', aktif: true });
const simpan = (nilai, alasan = null) => svc('SELECT public.simpan_draf_pengaturan($1,$2,$3::jsonb,NULL,$4) AS v', [K, 'llm', JSON.stringify(nilai), alasan]);

async function main() {
  await c.connect();
  await c.query("SET lock_timeout = '20s'; SET statement_timeout = '60s'");
  await c.query('BEGIN');
  try {
    await c.query(MIG);
    cek('migrasi diterapkan di dalam transaksi', true);

    // --- Akses ---
    for (const [peran, a] of [['anon', ANON], ['authenticated', AUTH]]) {
      for (const t of ['rahasia_pengaturan', 'pengaturan_sistem', 'pengaturan_riwayat']) {
        cek(`${peran} tidak bisa SELECT ${t}`, ditolak(await run(a, `SELECT * FROM public.${t}`)));
      }
      cek(`${peran} tidak bisa INSERT rahasia`, ditolak(await run(a, "INSERT INTO public.rahasia_pengaturan(nama,ciphertext,iv,tag) VALUES ('x','a','b','c')")));
      cek(`${peran} tidak bisa memanggil simpan_draf`, ditolak(await run(a, "SELECT public.simpan_draf_pengaturan('llm.rantai_chat','llm','[]'::jsonb,NULL,NULL)")));
      cek(`${peran} tidak bisa memanggil aktifkan`, ditolak(await run(a, "SELECT public.aktifkan_pengaturan('llm.rantai_chat',1,NULL,NULL,true)")));
      cek(`${peran} tidak bisa memanggil match_dokumen_layanan`, ditolak(await run(a, "SELECT * FROM public.match_dokumen_layanan('[0.1,0.2]'::extensions.vector, 0.1, 1, NULL)")));
    }
    cek('service_role boleh INSERT rahasia', (await svc("INSERT INTO public.rahasia_pengaturan(nama,ciphertext,iv,tag,last4) VALUES ('x','a','b','c','wxyz')")).ok);

    // --- Draf -> uji -> aktif -> rollback ---
    cek('nilai LLM non-array ditolak', (await svc("SELECT public.simpan_draf_pengaturan($1,'llm','{}'::jsonb,NULL,NULL)", [K])).code === '22023');
    const d1 = await simpan([entri(E1, 'A')]);
    cek('draf pertama = versi 1', d1.ok && d1.rows[0].v === 1, JSON.stringify(d1));
    const d1b = await simpan([entri(E1, 'A'), entri(E2, 'B')]);
    cek('simpan ulang memperbarui draf yang sama (versi 1)', d1b.ok && d1b.rows[0].v === 1);
    cek('aktifkan tanpa uji -> BELUM_DIUJI', /^BELUM_DIUJI/.test((await svc('SELECT public.aktifkan_pengaturan($1,1,NULL,NULL,false)', [K])).msg ?? ''));
    cek('aktifkan tanpa_uji butuh alasan', /^ALASAN_WAJIB/.test((await svc('SELECT public.aktifkan_pengaturan($1,1,NULL,$2,true)', [K, ' ab '])).msg ?? ''));
    await pgq("UPDATE public.pengaturan_sistem SET hasil_uji = $2::jsonb WHERE kunci = $1 AND status='draf'", [K, JSON.stringify({ [E1]: { ok: true } })]);
    cek('uji sebagian (E2 belum) -> tetap BELUM_DIUJI', /^BELUM_DIUJI/.test((await svc('SELECT public.aktifkan_pengaturan($1,1,NULL,NULL,false)', [K])).msg ?? ''));
    await pgq("UPDATE public.pengaturan_sistem SET hasil_uji = $2::jsonb WHERE kunci = $1 AND status='draf'", [K, JSON.stringify({ [E1]: { ok: true }, [E2]: { ok: true } })]);
    cek('semua entri lulus uji -> aktif', (await svc('SELECT public.aktifkan_pengaturan($1,1,NULL,NULL,false) AS v', [K])).ok);
    cek('aktifkan dua kali -> BUKAN_DRAF', /^BUKAN_DRAF/.test((await svc('SELECT public.aktifkan_pengaturan($1,1,NULL,NULL,false)', [K])).msg ?? ''));

    const d2 = await simpan([entri(E1, 'A'), { ...entri(E2, 'B'), model: 'baru' }]);
    cek('draf berikutnya = versi 2', d2.rows?.[0]?.v === 2);
    const uji = (await pgq("SELECT hasil_uji FROM public.pengaturan_sistem WHERE kunci=$1 AND versi=2", [K])).rows[0].hasil_uji;
    cek('hasil uji dipertahankan hanya untuk entri yang TIDAK berubah (E1 ya, E2 tidak)', uji[E1]?.ok === true && uji[E2] === undefined, JSON.stringify(uji));
    cek('aktifkan tanpa_uji + alasan jelas -> boleh', (await svc('SELECT public.aktifkan_pengaturan($1,2,NULL,$2,true)', [K, 'darurat, uji menyusul'])).ok);
    const st = (await pgq('SELECT versi,status FROM public.pengaturan_sistem WHERE kunci=$1 ORDER BY versi', [K])).rows;
    cek('v1 jadi arsip, v2 aktif (satu aktif)', st[0].status === 'arsip' && st[1].status === 'aktif', JSON.stringify(st));

    cek('rollback tanpa alasan ditolak', /^ALASAN_WAJIB/.test((await svc('SELECT public.rollback_pengaturan($1,1,NULL,$2)', [K, ''])).msg ?? ''));
    cek('rollback ke versi aktif ditolak (BUKAN_ARSIP)', /^BUKAN_ARSIP/.test((await svc('SELECT public.rollback_pengaturan($1,2,NULL,$2)', [K, 'coba saja'])).msg ?? ''));
    const rb = await svc('SELECT public.rollback_pengaturan($1,1,NULL,$2) AS v', [K, 'versi baru bermasalah']);
    cek('rollback menyalin v1 menjadi versi 3 aktif', rb.ok && rb.rows[0].v === 3, JSON.stringify(rb));
    const st2 = (await pgq('SELECT versi,status,alasan FROM public.pengaturan_sistem WHERE kunci=$1 ORDER BY versi', [K])).rows;
    cek('sejarah utuh: v1 arsip, v2 arsip, v3 aktif', st2.map((r) => r.status).join() === 'arsip,arsip,aktif', JSON.stringify(st2));
    cek('rollback tercatat di alasan', /Rollback ke v1/.test(st2[2].alasan));
    cek('tidak ada versi tak ada -> TIDAK_ADA', /^TIDAK_ADA/.test((await svc('SELECT public.aktifkan_pengaturan($1,99,NULL,NULL,true)', [K])).msg ?? ''));
    cek('indeks unik: dua aktif tidak mungkin', !(await pgq("UPDATE public.pengaturan_sistem SET status='aktif' WHERE kunci=$1 AND versi=1", [K])).ok);

    const rw = (await pgq("SELECT aksi FROM public.pengaturan_riwayat WHERE kunci=$1 ORDER BY id", [K])).rows.map((r) => r.aksi);
    cek('riwayat mencatat simpan_draf/aktifkan/rollback', rw.includes('simpan_draf') && rw.includes('aktifkan') && rw.includes('rollback'), rw.join());
    const au = (await pgq("SELECT aksi, detail::text AS d FROM public.audit_log WHERE entitas='pengaturan' AND entitas_id=$1", [K])).rows;
    cek('audit_log tercatat tanpa rahasia', au.length >= 6 && !au.some((r) => /ciphertext|wxyz/.test(r.d)), String(au.length));

    // --- Dokumen Peraturan (dimensi-agnostik, termasuk dokumen umum layanan NULL) ---
    const vec = (n, x) => `[${Array.from({ length: n }, () => x).join(',')}]`;
    const dok = await pgq("INSERT INTO public.dokumen_peraturan(judul, status) VALUES ('Uji Umum','berlaku') RETURNING id");
    const dokId = dok.rows[0].id;
    await pgq('INSERT INTO public.dokumen_potongan(dokumen_id, teks, embedding) VALUES ($1,$2,$3::extensions.vector)', [dokId, 'Pasal uji', vec(768, 0.1)]);
    const m = await svc('SELECT * FROM public.match_dokumen_layanan($1::extensions.vector, 0.5, 3, NULL)', [vec(768, 0.1)]);
    cek('match_dokumen_layanan menemukan dokumen umum', m.ok && m.rows.some((r) => r.judul === 'Uji Umum' && r.similarity > 0.99), JSON.stringify(m.msg ?? m.rows.length));
    const lay = await pgq('SELECT id FROM public.layanan LIMIT 1');
    if (lay.rows[0]) {
      const m2 = await svc('SELECT * FROM public.match_dokumen_layanan($1::extensions.vector, 0.5, 3, $2)', [vec(768, 0.1), lay.rows[0].id]);
      cek('dokumen umum ikut walau layanan dipilih', m2.ok && m2.rows.some((r) => r.judul === 'Uji Umum'));
    }
    const mm = await svc('SELECT * FROM public.match_dokumen_layanan($1::extensions.vector, 0.5, 3, NULL)', [vec(3072, 0.1)]);
    cek('dimensi tidak cocok -> galat (ditangkap bot, turun ke FAQ/FTS)', !mm.ok, mm.msg);
  } finally {
    await c.query('ROLLBACK');
    await c.end();
  }
  console.log(`\n${lulus} lolos, ${gagal.length} gagal (transaksi di-ROLLBACK)`);
  if (gagal.length) { console.log(gagal.join('\n')); process.exit(1); }
}
main().catch(async (e) => { console.error(e); try { await c.query('ROLLBACK'); } catch {} process.exit(1); });
