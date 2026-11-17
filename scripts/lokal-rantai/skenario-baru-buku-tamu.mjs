// PGlite lokal, seluruh skema asli sampai G2; tanpa .env, jaringan atau DB eksternal.
import { readFileSync } from 'node:fs';
import { bukaDbPenuh, sebagai, cek, ringkas } from './harness.mjs';
console.log('Host tujuan: PGlite lokal dalam memori; data sintetis, tanpa koneksi eksternal.');
const db = await bukaDbPenuh({ sampai: '202611160001' });
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = { admin: id(1), fo1: id(2), fo2: id(3), petugas: id(4), nonaktif: id(5), warga: id(6) };
const S = { admin: id(11), fo1: id(12), fo2: id(13), petugas: id(14), nonaktif: id(15) };
const T = id(21), T2 = id(22);
const pg = (sql, params) => sebagai(db, 'postgres', null, sql, params);
const user = (r, sql, params) => sebagai(db, 'authenticated', U[r], sql, params);
const wajib = r => { if (!r.ok) throw new Error(JSON.stringify(r)); return r; };
const nilai = r => wajib(r).rows[0]?.hasil;
const sql = readFileSync(new URL('../../supabase/migrations/202611160003_buku_tamu_ekspor.sql', import.meta.url), 'utf8');
try {
  wajib(await pg(`SET session_replication_role=replica;
    INSERT INTO auth.users(id,email) VALUES ${Object.entries(U).map(([r,v]) => `('${v}','${r}@example.invalid')`).join(',')};
    INSERT INTO petugas(id,auth_user_id,nama,role,aktif) VALUES ${Object.entries(S).map(([r,v]) =>
      `('${v}','${U[r]}','${r}','${r === 'admin' ? 'admin' : r === 'petugas' ? 'petugas' : 'front_office'}',${r !== 'nonaktif'})`).join(',')};
    INSERT INTO buku_tamu(id,nama,asal,no_hp,menemui_siapa,keperluan,waktu_masuk,dicatat_oleh)
      VALUES('${T}','Tamu Sintetis','CV Sintetis','+6281234567890','Kabid Lama','Rapat',now()-interval '2 hours','${S.fo1}'),
            ('${T2}','Tamu Lain','CV Dua','+6281234567891','Petugas Teks','Konsultasi',now()-interval '1 hour','${S.fo2}');
    SET session_replication_role=origin;`));
  wajib(await pg('BEGIN;\n' + sql + '\nCOMMIT;'));
  cek('migrasi menjaga teks lama dan kolom baru NULL', nilai(await pg('SELECT menemui_siapa=$2 AND waktu_keluar IS NULL AND menemui_petugas_id IS NULL AS hasil FROM buku_tamu WHERE id=$1', [T, 'Kabid Lama'])) === true);
  for (const r of ['admin','fo1','fo2']) {
    cek(`${r} membaca semua tamu termasuk pencatat lain`, nilai(await user(r, 'SELECT count(*)::int AS hasil FROM buku_tamu')) === 2);
  }
  for (const r of ['petugas','nonaktif','warga']) {
    cek(`${r} tidak membaca daftar tamu`, nilai(await user(r, 'SELECT count(*)::int AS hasil FROM buku_tamu')) === 0);
    const keluar = await user(r, 'SELECT buku_tamu_catat_keluar($1)', [T]);
    cek(`${r} ditolak checkout RPC`, !keluar.ok && keluar.kode === '42501');
    const tambah = await user(r, "INSERT INTO buku_tamu(nama,menemui_siapa,dicatat_oleh) VALUES('Uji','Kabid',$1)", [S.fo1]);
    cek(`${r} ditolak tambah langsung`, !tambah.ok && tambah.kode === '42501');
  }
  const anon = await sebagai(db, 'anon', null, 'SELECT buku_tamu_catat_keluar($1)', [T]);
  cek('anon tidak mendapat EXECUTE', !anon.ok && anon.kode === '42501');
  const tambah = await user('fo2', "INSERT INTO buku_tamu(nama,asal,no_hp,menemui_siapa,menemui_petugas_id,dicatat_oleh) VALUES('Baru','Asal','08123456789','Petugas A',$1,$2) RETURNING id", [S.petugas, S.fo2]);
  cek('FO menambah referensi petugas tanpa membuat antrean', tambah.ok && tambah.rows.length === 1);
  const baru = wajib(tambah).rows[0].id;
  const palsu = await user('fo1', "INSERT INTO buku_tamu(nama,menemui_siapa,dicatat_oleh) VALUES('Palsu','Kabid',$1)", [S.fo2]);
  cek('FO tidak dapat memalsukan pencatat', !palsu.ok && palsu.kode === '42501');
  const ganti = await user('fo2', "UPDATE buku_tamu SET nama='Berubah' WHERE id=$1 RETURNING id", [T]);
  cek('FO tidak memperoleh UPDATE umum', ganti.ok && ganti.rows.length === 0);
  const hapus = await user('fo2', 'DELETE FROM buku_tamu WHERE id=$1 RETURNING id', [T]);
  cek('FO tidak memperoleh DELETE', hapus.ok && hapus.rows.length === 0);
  const sebelum = await user('fo1', "SELECT buku_tamu_catat_keluar($1, now()-interval '3 hours')", [T]);
  cek('keluar sebelum masuk ditolak', !sebelum.ok && sebelum.kode === '22023');
  const masaDepan = await user('fo1', "SELECT buku_tamu_catat_keluar($1, now()+interval '1 hour')", [T]);
  cek('keluar masa depan ditolak', !masaDepan.ok && masaDepan.kode === '22023');
  const hilang = await user('fo1', 'SELECT buku_tamu_catat_keluar($1)', [id(999)]);
  cek('id tidak ditemukan eksplisit', !hilang.ok && hilang.kode === 'P0002');
  const hasil = nilai(await user('fo2', 'SELECT buku_tamu_catat_keluar($1) AS hasil', [T]));
  cek('FO lain dapat checkout tanpa mengubah pencatat', hasil.id === T && Boolean(hasil.waktu_keluar) &&
      nilai(await pg('SELECT dicatat_oleh AS hasil FROM buku_tamu WHERE id=$1', [T])) === S.fo1);
  const ulang = nilai(await user('admin', 'SELECT buku_tamu_catat_keluar($1) AS hasil', [T]));
  cek('checkout idempoten mempertahankan waktu pertama', ulang.waktu_keluar === hasil.waktu_keluar);
  cek('audit tepat sekali tanpa PII', nilai(await pg("SELECT count(*)::int AS hasil FROM audit_log WHERE aksi='catat_keluar' AND entitas_id=$1", [T])) === 1 &&
    !JSON.stringify(wajib(await pg("SELECT detail FROM audit_log WHERE aksi='catat_keluar' AND entitas_id=$1", [T])).rows).includes('+628'));
  cek('admin dapat checkout', Boolean(nilai(await user('admin', 'SELECT buku_tamu_catat_keluar($1) AS hasil', [baru])).waktu_keluar));
  // Audit gagal harus membatalkan perubahan waktu keluar dalam transaksi RPC yang sama.
  wajib(await pg(`CREATE FUNCTION public.uji_audit_gagal_g6() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.aksi='catat_keluar' THEN RAISE EXCEPTION 'audit uji ditolak'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER uji_audit_g6 BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION public.uji_audit_gagal_g6();`));
  const gagalAudit = await user('fo1', 'SELECT buku_tamu_catat_keluar($1)', [T2]);
  cek('audit gagal membuat RPC gagal', !gagalAudit.ok && gagalAudit.pesan.includes('audit uji ditolak'));
  cek('audit gagal merollback waktu keluar', nilai(await pg('SELECT waktu_keluar IS NULL AS hasil FROM buku_tamu WHERE id=$1', [T2])) === true);
  wajib(await pg('DROP TRIGGER uji_audit_g6 ON audit_log; DROP FUNCTION public.uji_audit_gagal_g6();'));
  const fk = await user('fo1', "INSERT INTO buku_tamu(nama,menemui_siapa,menemui_petugas_id,dicatat_oleh) VALUES('FK','Kabid',$1,$2)", [id(998), S.fo1]);
  cek('FK menolak petugas tidak ada', !fk.ok && fk.kode === '23503');
  const check = await user('admin', "UPDATE buku_tamu SET waktu_keluar=waktu_masuk-interval '1 minute' WHERE id=$1", [T]);
  cek('CHECK juga menahan penulisan waktu langsung admin', !check.ok && check.kode === '23514');
  wajib(await pg('INSERT INTO sesi_staf(user_id,session_id) VALUES($1,$2)', [U.fo1, id(101)]));
  cek('sesi digantikan menutup daftar RLS', nilai(await user('fo1', 'SELECT count(*)::int AS hasil FROM buku_tamu')) === 0);
  const sesi = await user('fo1', 'SELECT buku_tamu_catat_keluar($1)', [T2]);
  cek('sesi digantikan menutup checkout', !sesi.ok && sesi.pesan.startsWith('SESI_TIDAK_SAH:'));
  wajib(await pg('BEGIN;\n' + sql + '\nCOMMIT;'));
  cek('migrasi dapat diterapkan ulang tanpa kehilangan data', nilai(await pg('SELECT count(*)::int AS hasil FROM buku_tamu')) === 3);
  cek('Buku Tamu tidak membuat kunjungan atau tiket', nilai(await pg('SELECT (SELECT count(*) FROM kunjungan)+(SELECT count(*) FROM tiket_antrean) AS hasil')) === 0);
  ringkas();
} finally { await db.close(); }
