// PGlite opsional yang sudah terpasang; tanpa jaringan, .env, atau database eksternal.
// Jalankan: node scripts/lokal-rantai/skenario-akses-fo.mjs
import { readFileSync } from 'node:fs';
import { bukaDbPenuh, sebagai, cek, ringkas } from './harness.mjs';

console.log('Host tujuan: PGlite lokal dalam memori; data sintetis, tanpa koneksi eksternal.');
const db = await bukaDbPenuh();
const id = (grup, n) => `${grup}0000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = Object.fromEntries(['admin', 'fo1', 'fo2', 'fok', 'p1', 'p2', 'pk', 'p3', 'nonaktif', 'warga'].map((r, i) => [r, id(0, i + 1)]));
const staf = Object.fromEntries(Object.keys(U).map((r, i) => [r, id(2, i + 1)]));
const L = n => id(1, n);
const K = n => id(3, n);
const T = n => id(4, n);
const P = n => id(5, n);
const pg = (sql, params) => sebagai(db, 'postgres', null, sql, params);
const user = (role, sql, params) => sebagai(db, 'authenticated', U[role], sql, params);
const wajib = r => { if (!r.ok) throw new Error(JSON.stringify(r)); return r; };
const nilai = r => wajib(r).rows[0]?.hasil;
try {
  wajib(await pg(`
    SET session_replication_role = replica;
    INSERT INTO auth.users(id, email) VALUES ${Object.entries(U).map(([r, v]) => `('${v}', '${r}@example.invalid')`).join(',')};
    INSERT INTO layanan(id, nama, prefiks_antrean, slug, form_pendataan) VALUES
      ('${L(1)}','Layanan Satu','AA','uji-akses-fo-1','oss'), ('${L(2)}','Layanan Dua','BB','uji-akses-fo-2',NULL);
    INSERT INTO petugas(id, auth_user_id, nama, role, layanan_id, aktif, koordinator) VALUES
      ${Object.keys(U).filter(r => r !== 'warga').map(r => `('${staf[r]}','${U[r]}','${r}',
        '${r === 'admin' ? 'admin' : r.startsWith('p') ? 'petugas' : 'front_office'}',
        ${r.startsWith('p') ? `'${r === 'p3' ? L(2) : L(1)}'` : 'NULL'}, ${r !== 'nonaktif'}, ${r === 'fok' || r === 'pk'})`).join(',')};
    INSERT INTO kunjungan(id, nama, asal, tanggal, status, dibuat_oleh, kontak_hp, email, qr_token) VALUES
      ('${K(1)}','Warga Satu','walk_in',current_date,'selesai','${staf.fo1}','081234567801','satu@example.invalid','scan-satu'),
      ('${K(2)}','Warga Dua','walk_in',current_date,'selesai','${staf.fo2}','081234567802','dua@example.invalid','scan-dua'),
      ('${K(3)}','Warga Tiga','walk_in',current_date,'menunggu','${staf.fo2}','081234567803','tiga@example.invalid','scan-tiga'),
      ('${K(4)}','Reservasi Empat','reservasi',current_date,'terjadwal',NULL,'081234567804','empat@example.invalid','scan-empat'),
      ('${K(5)}','Warga Lima','walk_in',current_date,'selesai','${staf.fo2}','081234567805','lima@example.invalid','scan-lima'),
      ('${K(6)}','Legacy Enam','walk_in',current_date,'selesai',NULL,NULL,NULL,'scan-enam');
    INSERT INTO tiket_antrean(id, kunjungan_id, layanan_id, tanggal, nomor, nomor_display, status, dilayani_oleh, waktu_mulai_layan, waktu_selesai) VALUES
      ('${T(1)}','${K(1)}','${L(1)}',current_date,1,'AA-001','selesai','${staf.p1}',now()-interval '10 minutes',now()),
      ('${T(2)}','${K(2)}','${L(1)}',current_date,2,'AA-002','selesai','${staf.p2}',now()-interval '20 minutes',now()),
      ('${T(3)}','${K(3)}','${L(1)}',current_date,3,'AA-003','menunggu',NULL,NULL,NULL),
      ('${T(5)}','${K(5)}','${L(2)}',current_date,1,'BB-001','selesai','${staf.p3}',now()-interval '30 minutes',now()),
      ('${T(6)}','${K(6)}','${L(1)}',current_date,4,'AA-004','selesai','${staf.p2}',now()-interval '40 minutes',now());
    INSERT INTO penanganan(id, kunjungan_id, tahap_ke, peran_tahap, layanan_id, tiket_id, saluran, status, penangan_id, mulai_at, selesai_at, hasil, catatan, topik) VALUES
      ('${P(1)}','${K(1)}',1,'fo',NULL,NULL,'walk_in','selesai','${staf.fo1}',now()-interval '1 hour',now(),'dieskalasi','isian rahasia satu','Topik Uji'),
      ('${P(2)}','${K(1)}',2,'layanan','${L(1)}','${T(1)}','walk_in','selesai','${staf.p1}',now()-interval '10 minutes',now(),'selesai','isian rahasia layanan','Topik Uji'),
      ('${P(3)}','${K(2)}',1,'fo',NULL,NULL,'walk_in','selesai','${staf.fo2}',now()-interval '1 hour',now(),'dieskalasi','isian rahasia dua','Topik Uji'),
      ('${P(4)}','${K(2)}',2,'layanan','${L(1)}','${T(2)}','walk_in','selesai','${staf.p2}',now()-interval '20 minutes',now(),'selesai','isian rahasia layanan dua','Topik Uji'),
      ('${P(5)}','${K(3)}',1,'layanan','${L(1)}','${T(3)}','walk_in','menunggu',NULL,NULL,NULL,NULL,NULL,'Topik Uji'),
      ('${P(6)}','${K(5)}',1,'fo',NULL,NULL,'walk_in','selesai','${staf.fo2}',now()-interval '1 hour',now(),'dieskalasi','isian rahasia lima','Topik Uji'),
      ('${P(7)}','${K(5)}',2,'layanan','${L(2)}','${T(5)}','walk_in','selesai','${staf.p3}',now()-interval '30 minutes',now(),'selesai','isian rahasia layanan lima','Topik Uji');
    INSERT INTO pelayanan_oss(tiket_id,kunjungan_id,petugas_id,nama_pemohon,nama_usaha,tindak_lanjut,uraian_solusi,status_draft,email) VALUES
      ('${T(1)}','${K(1)}','${staf.p1}','Warga Satu','Usaha Satu','selesai','rahasia satu','selesai','satu@example.invalid'),
      ('${T(2)}','${K(2)}','${staf.p2}','Warga Dua','Usaha Dua','selesai','rahasia dua','selesai','dua@example.invalid'),
      ('${T(3)}','${K(3)}','${staf.p1}','Warga Tiga','Usaha Tiga','draf','rahasia terbuka','draft','tiga@example.invalid');
    SET session_replication_role = origin;
  `));
  const hari = nilai(await pg('SELECT current_date::text AS hasil'));
  const visible = async (who, table, column = 'id') => wajib(await user(who, `SELECT ${column} AS hasil FROM public.${table} ORDER BY ${column}`)).rows.map(r => r.hasil);
  cek('FO1 hanya kontak kunjungan yang ia daftarkan; pekerjaan rekan terbuka tertutup', JSON.stringify(await visible('fo1', 'kunjungan')) === JSON.stringify([K(1)]));
  cek('FO2 membaca kunjungan yang ia daftarkan', (await visible('fo2', 'kunjungan')).length === 3);
  cek('Admin membaca semua kunjungan', (await visible('admin', 'kunjungan')).length === 6);
  cek('FO Koordinator membaca semua kunjungan', (await visible('fok', 'kunjungan')).length === 6);
  cek('FO1 hanya tiket kunjungan dalam lingkup; tiket rekan hari ini tertutup', JSON.stringify(await visible('fo1', 'tiket_antrean')) === JSON.stringify([T(1)]));
  cek('FO pencatat masih membaca pendataan hasil eskalasinya', JSON.stringify(await visible('fo1', 'pelayanan_oss', 'tiket_id')) === JSON.stringify([T(1)]));
  cek('draf pekerjaan rekan yang masih terbuka tetap tidak terbaca', !(await visible('fo1', 'pelayanan_oss', 'tiket_id')).includes(T(3)));
  cek('Pendataan Khusus tetap hanya lingkup/pencatat, bukan rekan', nilai(await user('fo1', 'SELECT public.boleh_baca_khusus($1) AS hasil', [P(2)])) === true && nilai(await user('fo1', 'SELECT public.boleh_baca_khusus($1) AS hasil', [P(4)])) === false);
  cek('FO1 hanya tahap kunjungannya, tanpa catatan kunjungan rekan terbuka', JSON.stringify(await visible('fo1', 'penanganan')) === JSON.stringify([P(1), P(2)]));

  const antrean = nilai(await user('fo1', 'SELECT public.fo_antrean_daftar($1::date) AS hasil', [hari]));
  cek('daftar aman FO1 mencakup semua tiket hari ini lintas FO/layanan', antrean.total === 5 && antrean.rows.length === 5);
  cek('statistik seluruh daftar: 4 selesai, rata 25 menit', antrean.statistik.totalSelesai === 4 && antrean.statistik.rataWaktuMenit === 25);
  cek('nama FO rekan tersedia tanpa kontaknya', antrean.rows.find(r => r.id === T(2))?.fo_nama === 'fo2');
  cek('tiket lama tanpa tahap FO tetap tampil, nama FO null', antrean.rows.find(r => r.id === T(6))?.kunjungan?.nama === 'Legacy Enam' && antrean.rows.find(r => r.id === T(6))?.fo_nama === null);
  const aman = o => !/kontak_hp|email|asal_instansi|keperluan|catatan|rahasia|qr_token|legacy_visit_id|081234/i.test(JSON.stringify(o));
  cek('seluruh payload antrean tidak memiliki kontak/isian/QR/legacy', aman(antrean));
  const halaman = nilai(await user('fo1', 'SELECT public.fo_antrean_daftar($1::date,$2::uuid,1,1) AS hasil', [hari, L(1)]));
  cek('paginasi/filter: total 4, halaman 1, statistik sama filter', halaman.total === 4 && halaman.rows.length === 1 && halaman.rows[0].id === T(2) && halaman.statistik.totalSelesai === 3);
  const kunjungan = nilai(await user('fo1', 'SELECT public.fo_kunjungan_daftar($1::date,2,0) AS hasil', [hari]));
  cek('kunjungan bersama dibatasi halaman dengan total utuh', kunjungan.total === 6 && kunjungan.rows.length === 2 && aman(kunjungan));
  const scan = nilai(await user('fo1', "SELECT public.fo_pratinjau_reservasi(' scan-empat ') AS hasil"));
  cek('scan reservasi rekan tanpa membuka email/isian', scan.id === K(4) && scan.nama === 'Reservasi Empat' && aman(scan));
  cek('scan token tidak ada -> null', nilai(await user('fo1', "SELECT public.fo_pratinjau_reservasi('tidak-ada') AS hasil")) === null);

  for (const siapa of ['p1', 'pk', 'p3', 'nonaktif', 'warga']) {
    for (const panggil of ["fo_antrean_daftar(current_date)", "fo_kunjungan_daftar(current_date)", "fo_pratinjau_reservasi('scan-empat')"]) {
      const r = await user(siapa, `SELECT public.${panggil}`);
      cek(`${siapa} ditolak dari ${panggil.split('(')[0]}`, !r.ok && r.kode === '42501');
    }
  }
  const anon = await sebagai(db, 'anon', null, 'SELECT public.fo_antrean_daftar(current_date)');
  cek('anon tidak punya EXECUTE daftar', !anon.ok && anon.kode === '42501');
  const anonimRingkasan = await sebagai(db, 'anon', null, 'SELECT public.rekap_ringkasan_dilayani(current_date,current_date)');
  cek('anon tidak punya EXECUTE total lintas orang', !anonimRingkasan.ok && anonimRingkasan.kode === '42501');
  const total = async (siapa, unit = null, layanan = null, tanpaForm = false) => nilai(await user(siapa,
    'SELECT public.rekap_ringkasan_dilayani($1::date,$1::date,$2::text,$3::uuid,$4::boolean) AS hasil', [hari, unit, layanan, tanpaForm]));
  cek('FO1: saya 1/total 3 FO (33,33%)', JSON.stringify(await total('fo1', 'fo')) === JSON.stringify({saya: 1, total: 3, persen: 33.33}));
  cek('FO biasa tanpa unit tetap membandingkan kerja FO saja', JSON.stringify(await total('fo1')) === JSON.stringify({saya: 1, total: 3, persen: 33.33}));
  cek('FO biasa meminta unit layanan tidak mendapat total kerja Petugas', (await total('fo1', 'layanan')).total === 0);
  cek('FO2: saya 2/total 3 FO (66,67%)', (await total('fo2', 'fo')).persen === 66.67);
  cek('Admin: 7/7, tanpa baris atau ID', JSON.stringify(await total('admin')) === JSON.stringify({saya: 7, total: 7, persen: 100}));
  cek('FO Koordinator: 7/7', (await total('fok')).persen === 100 && (await total('fok')).total === 7);
  cek('Petugas1: saya 1/total 3 layanannya (bukan 7 semua unit)', JSON.stringify(await total('p1')) === JSON.stringify({saya: 1, total: 3, persen: 33.33}));
  cek('Koordinator Petugas: hanya 3/3 layanannya', (await total('pk')).total === 3 && (await total('pk')).persen === 100);
  cek('Petugas tidak bisa mengetahui total FO', (await total('p1', 'fo')).total === 0);
  cek('Petugas tidak bisa mengetahui total layanan lain', (await total('p1', null, L(2))).total === 0);
  cek('filter tanpa formulir menghapus OSS, menyisakan FO dan layanan lain', (await total('admin', null, null, true)).total === 4);
  cek('filter layanan sama pada pembilang/penyebut', (await total('admin', 'layanan', L(2))).total === 1);
  const takAda = nilai(await user('admin', 'SELECT public.rekap_ringkasan_dilayani(current_date-1,current_date-1) AS hasil'));
  cek('periode kosong mengembalikan tiga nol tanpa pembagian nol', JSON.stringify(takAda) === JSON.stringify({saya: 0, total: 0, persen: 0}));
  const rentang = await user('fo1', "SELECT public.rekap_ringkasan_dilayani(current_date-366,current_date)");
  cek('periode melebihi 366 hari ditolak 22023', !rentang.ok && rentang.kode === '22023');
  for (const arg of ['NULL,50,0', 'current_date,201,0', 'current_date,50,-1', 'current_date,50,2000001']) {
    const r = await user('fo1', `SELECT public.fo_kunjungan_daftar(${arg})`);
    cek(`batas daftar ${arg} ditolak`, !r.ok && r.kode === '22023');
  }
  const migrasi = readFileSync(new URL('../../supabase/migrations/202611030015_akses_fo_antrean.sql', import.meta.url), 'utf8');
  wajib(await pg(migrasi));
  cek('0015 idempoten pada rantai dan data yang sudah ada', nilai(await user('fo1', 'SELECT public.fo_antrean_daftar(current_date) AS hasil')).total === 5);
  wajib(await pg(`INSERT INTO sesi_staf(user_id, session_id) VALUES ('${U.fo1}','${id(7, 1)}')`));
  const sesi = await user('fo1', 'SELECT public.fo_antrean_daftar(current_date)');
  cek('sesi staf yang digantikan tidak bisa membaca RPC aman', !sesi.ok && sesi.kode === '42501' && sesi.pesan.startsWith('SESI_TIDAK_SAH:'));
  wajib(await pg('DELETE FROM sesi_staf WHERE user_id = $1', [U.fo1]));

  // Rollback diuji pada instance in-memory yang sama; definisi asli dikembalikan tanpa mengubah data.
  const rollback = readFileSync(new URL('../../docs/rollback-akses-fo-antrean-202611030015.sql', import.meta.url), 'utf8');
  wajib(await pg(rollback));
  cek('rollback mengembalikan jendela FO untuk kunjungan rekan terbuka', (await visible('fo1', 'kunjungan')).includes(K(3)));
  cek('rollback menghapus RPC baru', nilai(await pg("SELECT to_regprocedure('public.fo_antrean_daftar(date,uuid,integer,integer)')::text AS hasil")) === null);
  cek('rollback tidak menghapus kunjungan', Number(nilai(await pg('SELECT count(*) AS hasil FROM kunjungan'))) === 6);
  ringkas();
} finally {
  await db.close();
}
