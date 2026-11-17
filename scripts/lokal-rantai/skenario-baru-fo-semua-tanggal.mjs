// G8: tanggal daftar FO bebas; PII pengunjung lama dan lingkup petugas tetap.
import { readFileSync } from 'node:fs';
import { bukaDbPenuh, sebagai, cek, ringkas } from './harness.mjs';

console.log('Host tujuan: PGlite lokal dalam memori; data sintetis, tanpa koneksi eksternal.');
const db = await bukaDbPenuh({ sampai: '202611160003' });
const id = (grup, n) => `${grup}0000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = Object.fromEntries(['admin', 'fo1', 'fo2', 'fok', 'p1', 'p2', 'nonaktif', 'warga'].map((r, i) => [r, id(0, i + 1)]));
const S = Object.fromEntries(Object.keys(U).map((r, i) => [r, id(1, i + 1)]));
const L = n => id(2, n), K = n => id(3, n), T = n => id(4, n);
const pg = (sql, params) => sebagai(db, 'postgres', null, sql, params);
const user = (r, sql, params) => sebagai(db, 'authenticated', U[r], sql, params);
const wajib = r => { if (!r.ok) throw new Error(JSON.stringify(r)); return r; };
const nilai = r => wajib(r).rows[0]?.hasil;
const sql = readFileSync(new URL('../../supabase/migrations/202611160004_fo_semua_tanggal.sql', import.meta.url), 'utf8');
const rpcs = ['fo_antrean_daftar', 'fo_kunjungan_daftar'];
const daftar = (r, fn, hari) => user(r, `SELECT public.${fn}(current_date + $1::int) AS hasil`, [hari]);
const terlihat = async (r, tabel) => wajib(await user(r, `SELECT id FROM public.${tabel} ORDER BY id`)).rows.map(v => v.id);
const sama = (a, b) => JSON.stringify(a) === JSON.stringify(b);
try {
  wajib(await pg("SET TIME ZONE 'Asia/Jakarta'"));
  wajib(await pg(`SET session_replication_role=replica;
    INSERT INTO auth.users(id,email) VALUES ${Object.entries(U).map(([r, v]) => `('${v}','${r}@example.invalid')`).join(',')};
    INSERT INTO layanan(id,nama,prefiks_antrean,slug) VALUES
      ('${L(1)}','Layanan A Sintetis','AA','g8-a'),('${L(2)}','Layanan B Sintetis','BB','g8-b');
    INSERT INTO petugas(id,auth_user_id,nama,role,layanan_id,aktif,koordinator) VALUES
      ${Object.keys(U).filter(r => r !== 'warga').map(r => `('${S[r]}','${U[r]}','${r}',
      '${r === 'admin' ? 'admin' : r.startsWith('p') ? 'petugas' : 'front_office'}',
      ${r.startsWith('p') ? `'${L(r === 'p1' ? 1 : 2)}'` : 'NULL'},${r !== 'nonaktif'},${r === 'fok'})`).join(',')};
    INSERT INTO kunjungan(id,nama,asal,tanggal,status,dibuat_oleh,kontak_hp,email,qr_token,waktu_masuk) VALUES
      ('${K(1)}','Lampau A','walk_in',current_date-60,'selesai','${S.fo2}','081234567801','lama@example.invalid','g8-lama',now()-interval '60 days'),
      ('${K(2)}','Lampau B','walk_in',current_date-60,'menunggu','${S.fo2}','081234567802','lain@example.invalid','g8-lain',now()-interval '60 days'),
      ('${K(3)}','Depan A','reservasi',current_date+60,'menunggu','${S.fo2}','081234567803','depan@example.invalid','g8-depan',now()+interval '60 days'),
      ('${K(4)}','Depan B','reservasi',current_date+60,'menunggu','${S.fo2}','081234567804','depan-b@example.invalid','g8-depan-b',now()+interval '60 days'),
      ('${K(5)}','Baru FO lain','walk_in',current_date,'menunggu','${S.fo2}','081234567805','baru@example.invalid','g8-baru',now());
    INSERT INTO tiket_antrean(id,kunjungan_id,layanan_id,tanggal,nomor,nomor_display,status,dilayani_oleh,waktu_mulai_layan,waktu_selesai) VALUES
      ('${T(1)}','${K(1)}','${L(1)}',current_date-60,1,'AA-001','selesai','${S.p1}',now()-interval '60 days 10 minutes',now()-interval '60 days'),
      ('${T(2)}','${K(2)}','${L(2)}',current_date-60,1,'BB-001','menunggu',NULL,NULL,NULL),
      ('${T(3)}','${K(3)}','${L(1)}',current_date+60,1,'AA-001','menunggu',NULL,NULL,NULL),
      ('${T(4)}','${K(4)}','${L(2)}',current_date+60,1,'BB-001','menunggu',NULL,NULL,NULL);
    UPDATE kunjungan SET asal_instansi='Instansi Sintetis' WHERE id IN ('${K(1)}','${K(2)}','${K(3)}','${K(4)}','${K(5)}');
    SET session_replication_role=origin;`));
  const piiSebelum = nilai(await pg("SELECT pg_get_functiondef('public.fo_ambil_pengunjung(uuid)'::regprocedure) AS hasil"));
  const meta = () => pg(`SELECT proname,pg_get_function_identity_arguments(oid) AS args,proacl,proconfig,provolatile,prosecdef
    FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('fo_antrean_daftar','fo_kunjungan_daftar') ORDER BY proname`);
  const metaSebelum = wajib(await meta()).rows;
  const lingkupSebelum = {};
  for (const r of ['p1', 'p2']) {
    lingkupSebelum[r] = {};
    for (const tabel of ['tiket_antrean', 'kunjungan']) lingkupSebelum[r][tabel] = await terlihat(r, tabel);
  }
  for (const fn of rpcs) for (const hari of [-60, 60]) {
    const lama = await daftar('fo1', fn, hari);
    cek(`sebelum G8 ${fn} tanggal ${hari} ditolak jendela hidup`, !lama.ok && lama.kode === '22023' && lama.pesan.startsWith('TANGGAL_DILUAR_BATAS:'));
  }
  wajib(await pg('BEGIN;\n' + sql + '\nCOMMIT;'));
  cek('signature, keamanan, ACL, search_path dan volatilitas tetap', sama(wajib(await meta()).rows, metaSebelum));
  for (const r of ['fo1', 'fok', 'admin']) for (const hari of [-60, 60]) {
    const antrean = nilai(await daftar(r, rpcs[0], hari));
    const kunjungan = nilai(await daftar(r, rpcs[1], hari));
    const ids = hari < 0 ? [1, 2] : [3, 4];
    cek(`${r} membaca antrean ${hari} hari seluruh layanan`, antrean.total === 2 && sama(antrean.rows.map(v => v.id), ids.map(T)));
    cek(`${r} membaca kunjungan ${hari} hari FO lain`, kunjungan.total === 2 && sama(kunjungan.rows.map(v => v.id).sort(), ids.map(K)) && kunjungan.rows.every(v => v.fo_nama === 'fo2'));
    cek(`${r} daftar aman ${hari} tanpa HP/email/token/isian`, !/kontak_hp|email|qr_token|catatan|0812345678|@example/.test(JSON.stringify([antrean, kunjungan])));
  }
  const statistik = nilai(await daftar('fo1', rpcs[0], -60)).statistik;
  cek('statistik tanggal lampau tetap dihitung', statistik.totalSelesai === 1 && statistik.rataWaktuMenit === 10);
  const filterLayanan = nilai(await user('fo1', 'SELECT fo_antrean_daftar(current_date-60,$1,1,0) AS hasil', [L(2)]));
  cek('filter layanan dan paginasi antrean tetap', filterLayanan.total === 1 && filterLayanan.rows[0]?.id === T(2));
  const halaman = nilai(await user('fo1', 'SELECT fo_kunjungan_daftar(current_date-60,1,1,NULL,NULL) AS hasil', []));
  cek('paginasi kunjungan tetap', halaman.total === 2 && halaman.rows.length === 1 && halaman.rows[0].id === K(2));
  const cari = nilai(await user('fo1', "SELECT fo_kunjungan_daftar(current_date-60,1,0,'Lampau A','selesai') AS hasil", []));
  cek('cari dan status diterapkan sebelum paginasi', cari.total === 1 && cari.rows[0]?.id === K(1));
  for (const r of ['p1', 'p2', 'nonaktif', 'warga']) for (const fn of rpcs) {
    const hasil = await daftar(r, fn, -60);
    cek(`${r} tetap ditolak RPC ${fn}`, !hasil.ok && hasil.kode === '42501');
  }
  for (const r of ['p1', 'p2']) for (const tabel of ['tiket_antrean', 'kunjungan']) {
    const hasil = await terlihat(r, tabel);
    const target = r === 'p1' ? [1, 3] : [2, 4];
    cek(`${r} lingkup ${tabel} tetap termasuk tanggal jauh`, sama(hasil, lingkupSebelum[r][tabel]) && sama(hasil, target.map(tabel === 'kunjungan' ? K : T)));
  }
  for (const fn of rpcs) {
    const anon = await sebagai(db, 'anon', null, `SELECT ${fn}(current_date-60)`);
    cek(`anon tidak mendapat execute ${fn}`, !anon.ok && anon.kode === '42501');
    const invalid = await user('fo1', `SELECT ${fn}(NULL)`);
    cek(`tanggal NULL tetap ditolak ${fn}`, !invalid.ok && invalid.kode === '22023');
    const batas = await user('fo1', fn === rpcs[0] ? 'SELECT fo_antrean_daftar(current_date,NULL,201,0)' : 'SELECT fo_kunjungan_daftar(current_date,201,0)');
    cek(`batas halaman tetap ditolak ${fn}`, !batas.ok && batas.kode === '22023');
  }
  cek('definisi ambil pengunjung PII tidak berubah', nilai(await pg("SELECT pg_get_functiondef('public.fo_ambil_pengunjung(uuid)'::regprocedure) AS hasil")) === piiSebelum);
  const piiBaru = await user('fo1', 'SELECT * FROM fo_ambil_pengunjung($1)', [K(5)]);
  cek('PII kunjungan FO lain 7 hari terakhir tetap ditolak', !piiBaru.ok && piiBaru.kode === '42501');
  const piiLama = wajib(await user('fo1', 'SELECT * FROM fo_ambil_pengunjung($1)', [K(1)]));
  cek('PII kunjungan lama tetap melalui RPC khusus', piiLama.rows[0]?.kontak_hp === '081234567801');
  wajib(await pg('INSERT INTO sesi_staf(user_id,session_id) VALUES($1,$2)', [U.fo1, id(5, 1)]));
  for (const fn of rpcs) {
    const sesi = await daftar('fo1', fn, -60);
    cek(`sesi diganti tetap menutup ${fn}`, !sesi.ok && sesi.kode === '42501' && sesi.pesan.startsWith('SESI_TIDAK_SAH:'));
  }
  wajib(await pg('BEGIN;\n' + sql + '\nCOMMIT;'));
  cek('migrasi idempoten, data sintetis tetap', nilai(await pg('SELECT count(*)::int AS hasil FROM tiket_antrean')) === 4);
  ringkas();
} finally { await db.close(); }
