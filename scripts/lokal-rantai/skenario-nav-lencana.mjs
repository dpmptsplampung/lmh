// Paritas nav_lencana_saya (202611110002) vs predikat query lama useNavBadges.hitungBadge, per role, pada skema asli.
// PGlite dalam memori; tanpa jaringan, .env, atau DB eksternal. Jalankan: node scripts/lokal-rantai/skenario-nav-lencana.mjs
import { readFileSync } from 'node:fs';
import { bukaDbPenuh, sebagai, cek, ringkas } from './harness.mjs';

console.log('Host tujuan: PGlite lokal dalam memori; data sintetis, tanpa koneksi eksternal.');
const db = await bukaDbPenuh();
const id = (g, n) => `${g}0000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const R = ['admin', 'fo1', 'fo2', 'p1', 'p2', 'ptanpa', 'nonaktif', 'warga'];
const U = Object.fromEntries(R.map((r, i) => [r, id(0, i + 1)]));
const S = Object.fromEntries(R.map((r, i) => [r, id(2, i + 1)]));
const L = (n) => id(1, n), K = (n) => id(3, n), T = (n) => id(4, n), P = (n) => id(5, n), C = (n) => id(7, n), G = (n) => id(8, n);
const pg = (sql, params) => sebagai(db, 'postgres', null, sql, params);
const user = (r, sql, params) => sebagai(db, 'authenticated', U[r], sql, params);
const wajib = (r) => { if (!r.ok) throw new Error(JSON.stringify(r)); return r; };
const nilai = (r) => wajib(r).rows[0]?.hasil;
try {
  const peranDb = { admin: 'admin', fo1: 'front_office', fo2: 'front_office', p1: 'petugas', p2: 'petugas', ptanpa: 'petugas', nonaktif: 'front_office' };
  wajib(await pg(`
    SET session_replication_role = replica;
    INSERT INTO auth.users(id, email) VALUES ${R.map((r) => `('${U[r]}','${r}@example.invalid')`).join(',')};
    INSERT INTO layanan(id, nama, prefiks_antrean, slug, form_pendataan) VALUES
      ('${L(1)}','Layanan Satu','AA','uji-nav-1',NULL), ('${L(2)}','Layanan Dua','BB','uji-nav-2',NULL);
    INSERT INTO petugas(id, auth_user_id, nama, role, layanan_id, aktif) VALUES
      ${Object.keys(peranDb).map((r) => `('${S[r]}','${U[r]}','${r}','${peranDb[r]}',${r === 'p1' ? `'${L(1)}'` : r === 'p2' ? `'${L(2)}'` : 'NULL'},${r !== 'nonaktif'})`).join(',')};
    INSERT INTO kunjungan(id, nama, asal, tanggal, status, dibuat_oleh) VALUES
      ${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `('${K(n)}','Warga ${n}','walk_in',current_date,'menunggu','${S.fo1}')`).join(',')};
    INSERT INTO tiket_antrean(id, kunjungan_id, layanan_id, tanggal, nomor, nomor_display, status) VALUES
      ('${T(1)}','${K(1)}','${L(1)}',current_date,1,'AA-001','menunggu'),
      ('${T(2)}','${K(2)}','${L(1)}',current_date,2,'AA-002','dipanggil'),
      ('${T(3)}','${K(3)}','${L(2)}',current_date,1,'BB-001','menunggu'),
      ('${T(4)}','${K(4)}','${L(1)}',current_date-1,3,'AA-003','menunggu'),
      ('${T(5)}','${K(5)}','${L(1)}',current_date,4,'AA-004','selesai');
    INSERT INTO penanganan(id, kunjungan_id, tahap_ke, peran_tahap, layanan_id, tiket_id, saluran, status, penangan_id, mulai_at) VALUES
      ('${P(1)}','${K(1)}',1,'fo',NULL,NULL,'walk_in','menunggu',NULL,NULL),
      ('${P(2)}','${K(2)}',2,'fo',NULL,NULL,'walk_in','menunggu',NULL,NULL),
      ('${P(3)}','${K(3)}',1,'fo',NULL,NULL,'chat','menunggu',NULL,NULL),
      ('${P(4)}','${K(4)}',1,'fo',NULL,NULL,'walk_in','berjalan','${S.fo1}',now()),
      ('${P(5)}','${K(5)}',1,'fo',NULL,NULL,'walk_in','berjalan','${S.fo2}',now()),
      ('${P(6)}','${K(6)}',1,'fo',NULL,NULL,'walk_in','berjalan','${S.fo2}',now());
    INSERT INTO chat_sesi(id, layanan_id, status) VALUES
      ('${C(1)}','${L(1)}','eskalasi'), ('${C(2)}','${L(1)}','eskalasi'), ('${C(3)}','${L(2)}','eskalasi'), ('${C(4)}','${L(1)}','bot');
    INSERT INTO pengaduan(id, nomor_tiket, jalur, layanan_id, isi, status, batas_verifikasi, batas_penanganan) VALUES
      ('${G(1)}','PGD-NAV-1','layanan','${L(1)}','isi pengaduan satu cukup panjang','baru',current_date+1,current_date+5),
      ('${G(2)}','PGD-NAV-2','layanan','${L(2)}','isi pengaduan dua cukup panjang','baru',current_date+1,current_date+5),
      ('${G(3)}','PGD-NAV-3','integritas',NULL,'isi pengaduan tiga cukup panjang','baru',current_date+1,current_date+5),
      ('${G(4)}','PGD-NAV-4','layanan','${L(1)}','isi pengaduan empat cukup panjang','diverifikasi',current_date+1,current_date+5);
    INSERT INTO saran(id, isi) VALUES ('${id(9, 1)}','saran satu'), ('${id(9, 2)}','saran dua'), ('${id(9, 3)}','saran tiga');
    UPDATE saran SET ditinjau_pada = now() WHERE id = '${id(9, 3)}';
    SET session_replication_role = origin;
  `));
  const hari = nilai(await pg('SELECT current_date::text AS hasil'));

  // Predikat query LAMA (useNavBadges.hitungBadge) ditulis ulang sebagai SQL biasa, dijalankan sebagai pemanggil yang sama.
  const c = async (r, sql, p) => Number(nilai(await user(r, `SELECT count(*)::int AS hasil FROM ${sql}`, p)));
  const lama = async (r, hariTanpa = false) => {
    const role = peranDb[r];
    const out = {};
    if (['admin', 'front_office'].includes(role)) {
      const d = "public.penanganan WHERE peran_tahap='fo' AND status='menunggu' AND saluran<>'chat'";
      out.kotakMasukFo = { semua: await c(r, d), kembali: await c(r, d + ' AND tahap_ke>1') };
    }
    if (['admin', 'petugas', 'front_office'].includes(role)) {
      if (hariTanpa) out.liveChat = 0;
      else if (role === 'front_office') out.liveChat = await c(r, "public.penanganan WHERE saluran='chat' AND peran_tahap='fo' AND status='menunggu'");
      else if (role === 'petugas' && r !== 'ptanpa') out.liveChat = await c(r, "public.chat_sesi WHERE status='eskalasi' AND layanan_id=(SELECT layanan_id FROM petugas WHERE auth_user_id=auth.uid())");
      else out.liveChat = await c(r, "public.chat_sesi WHERE status='eskalasi'");
    }
    if (['admin', 'front_office'].includes(role)) out.penangananFo = await c(r, "public.penanganan WHERE peran_tahap='fo' AND status='berjalan' AND penangan_id=(SELECT id FROM petugas WHERE auth_user_id=auth.uid())");
    if (role === 'petugas') {
      if (r !== 'ptanpa') out.antrian = await c(r, "public.tiket_antrean WHERE tanggal=$1 AND status IN ('menunggu','dipanggil') AND layanan_id=(SELECT layanan_id FROM petugas WHERE auth_user_id=auth.uid())", [hari]);
    } else out.antrian = await c(r, "public.tiket_antrean WHERE tanggal=$1 AND status='menunggu'", [hari]);
    if (role === 'admin') out.pengaduan = await c(r, "public.pengaduan WHERE status='baru'");
    if (role === 'front_office') out.pengaduan = await c(r, "public.pengaduan WHERE status='baru' AND jalur='layanan'");
    if (['admin', 'front_office'].includes(role)) out.saran = await c(r, 'public.saran WHERE ditinjau_pada IS NULL');
    return out;
  };
  const rpc = async (r, hariTanpa = false) => nilai(await user(r, 'SELECT public.nav_lencana_saya($1::date,$2::boolean) AS hasil', [hari, hariTanpa]));
  const urut = (o) => JSON.stringify(Object.entries(o).sort());

  for (const r of ['admin', 'fo1', 'fo2', 'p1', 'p2', 'ptanpa']) {
    const a = await rpc(r), b = await lama(r);
    cek(`paritas ${r}: RPC = query lama`, urut(a) === urut(b), JSON.stringify({ a, b }));
  }
  const a = await rpc('fo1', true), b = await lama('fo1', true);
  cek('paritas hari tanpa layanan: liveChat 0', a.liveChat === 0 && urut(a) === urut(b));

  // Nilai absolut agar paritas tidak lolos karena dua-duanya nol.
  const adm = await rpc('admin');
  cek('admin: angka bermakna', adm.kotakMasukFo.semua === 2 && adm.kotakMasukFo.kembali === 1 && adm.liveChat === 3 && adm.antrian === 2 && adm.pengaduan === 3 && adm.saran === 2, JSON.stringify(adm));
  const fo1 = await rpc('fo1'), fo2 = await rpc('fo2');
  cek('FO: penangananFo per orang (1 vs 2); pengaduan tanpa jalur integritas', fo1.penangananFo === 1 && fo2.penangananFo === 2 && fo1.pengaduan === 2, JSON.stringify({ fo1, fo2 }));
  cek('FO: liveChat dari penanganan chat (bukan chat_sesi)', fo1.liveChat === 1);
  const p1 = await rpc('p1');
  cek('petugas: hanya antrian + liveChat layanannya', JSON.stringify(Object.keys(p1).sort()) === '["antrian","liveChat"]' && p1.liveChat === 2 && p1.antrian === 2, JSON.stringify(p1));
  const pt = await rpc('ptanpa');
  cek('petugas tanpa layanan: tanpa antrian, liveChat 0 (RLS chat_sesi, sama dengan query lama)', pt.antrian === undefined && pt.liveChat === 0, JSON.stringify(pt));
  cek('petugas nonaktif dan pengunjung: {}', JSON.stringify(await rpc('nonaktif')) === '{}' && JSON.stringify(await rpc('warga')) === '{}');
  const anon = await sebagai(db, 'anon', null, 'SELECT public.nav_lencana_saya(current_date)');
  cek('anon tidak punya EXECUTE', !anon.ok && anon.kode === '42501');
  cek('SECURITY INVOKER, STABLE', (await pg("SELECT prosecdef::text||provolatile::text AS hasil FROM pg_proc WHERE proname='nav_lencana_saya'")).rows[0].hasil === 'falses');

  const rollback = readFileSync(new URL('../../docs/rollback-nav-lencana-202611110002.sql', import.meta.url), 'utf8');
  wajib(await pg(rollback));
  cek('rollback menghapus fungsi', nilai(await pg("SELECT to_regprocedure('public.nav_lencana_saya(date,boolean)')::text AS hasil")) === null);
  const hilang = await user('admin', 'SELECT public.nav_lencana_saya(current_date)');
  cek('setelah rollback: galat 42883 (klien jatuh ke jalur lama)', !hilang.ok && hilang.kode === '42883');
  ringkas();
} finally {
  await db.close();
}
