// Skenario: identitas pengunjung = SATU KESATUAN (data induk FO dilengkapi petugas layanan; FO pencatat boleh membaca).
// Jalankan: node scripts/lokal-rantai/skenario-identitas.mjs  (PGlite, seluruh rantai migrasi; tanpa jaringan)
import { readFileSync } from 'node:fs';
import { bukaDbPenuh, sebagai, cek, ringkas } from './harness.mjs';

const ID = (a, n) => `${a}0000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const AUTH = { fo1: ID(1, 1), fo2: ID(1, 2), poss: ID(1, 3), pnon: ID(1, 4), pkhu: ID(1, 5), v1: ID(1, 6) };
const PET = { fo1: ID(2, 1), fo2: ID(2, 2), poss: ID(2, 3), pnon: ID(2, 4), pkhu: ID(2, 5) };
const L = { oss: ID(3, 1), non: ID(3, 2), khu: ID(3, 3) };

const TOPIK = ID(7, 1);
const db = await bukaDbPenuh();
const pg = (sql, params) => sebagai(db, 'postgres', null, sql, params);

const seed = await pg(`
  INSERT INTO auth.users(id, email) SELECT x::uuid, 'u' || right(x, 2) || '@x.id' FROM unnest(ARRAY[
    '${AUTH.fo1}','${AUTH.fo2}','${AUTH.poss}','${AUTH.pnon}','${AUTH.pkhu}','${AUTH.v1}']) x;
  INSERT INTO layanan(id, nama, prefiks_antrean, slug, form_pendataan) VALUES
    ('${L.oss}','Helpdesk OSS','AA','oss','oss'),('${L.non}','Non OSS','BB','non','perizinan'),('${L.khu}','Layanan Khusus','CC','khu',NULL);
  INSERT INTO petugas(id, auth_user_id, nama, role, layanan_id, aktif) VALUES
    ('${PET.fo1}','${AUTH.fo1}','FO Satu','front_office',NULL,true),
    ('${PET.fo2}','${AUTH.fo2}','FO Dua','front_office',NULL,true),
    ('${PET.poss}','${AUTH.poss}','Petugas OSS','petugas','${L.oss}',true),
    ('${PET.pnon}','${AUTH.pnon}','Petugas NonOSS','petugas','${L.non}',true),
    ('${PET.pkhu}','${AUTH.pkhu}','Petugas Khusus','petugas','${L.khu}',true);
  INSERT INTO topik_penanganan(id, layanan_id, nama) VALUES ('${ID(7, 1)}','${L.khu}','Konsultasi');
  INSERT INTO pengunjung(id, auth_user_id, nama, email) VALUES ('${ID(6, 1)}','${AUTH.v1}','Pengunjung Google','google@x.id');`);
if (!seed.ok) { console.error('SEED GAGAL', seed.pesan); process.exit(2); }

let nomor = 0;
/** Siapkan satu kunjungan yang sedang dilayani di layanan `lyn` oleh petugas `pet` (hasil eskalasi FO `fo`). */
async function siapkan({ lyn, pet, fo = 'fo1', email = null, hp = null, instansi = 'CV Awal FO', pengunjung = null }) {
  nomor += 1;
  const k = ID(4, nomor), t = ID(5, nomor), pf = ID(6, 10 + nomor), pl = ID(6, 50 + nomor);
  const r = await pg(`
    INSERT INTO kunjungan(id, nama, asal, tanggal, status, dibuat_oleh, email, kontak_hp, asal_instansi, keperluan, pengunjung_id, qr_token)
    VALUES ('${k}','Budi Santoso','walk_in', current_date,'dilayani','${PET[fo]}', ${email ? `'${email}'` : 'NULL'}, ${hp ? `'${hp}'` : 'NULL'}, '${instansi}', 'Konsultasi awal dari FO', ${pengunjung ? `'${pengunjung}'` : 'NULL'}, 'tok-${nomor}');
    INSERT INTO tiket_antrean(id, kunjungan_id, layanan_id, tanggal, nomor, nomor_display, status, dilayani_oleh, waktu_mulai_layan)
    VALUES ('${t}','${k}','${lyn}', current_date, ${nomor}, 'T-${nomor}','dilayani','${PET[pet]}', now());
    INSERT INTO penanganan(id, kunjungan_id, tahap_ke, peran_tahap, layanan_id, saluran, status, penangan_id, mulai_at, selesai_at, hasil, catatan, topik)
    VALUES ('${pf}','${k}',1,'fo',NULL,'walk_in','selesai','${PET[fo]}', now(), now(),'dieskalasi','catatan fo','topik fo');
    INSERT INTO penanganan(id, kunjungan_id, tahap_ke, peran_tahap, layanan_id, tiket_id, saluran, status, penangan_id, mulai_at)
    VALUES ('${pl}','${k}',2,'layanan','${lyn}','${t}','walk_in','berjalan','${PET[pet]}', now());`);
  if (!r.ok) { console.error('SIAPKAN GAGAL', r.pesan); process.exit(2); }
  return { k, t, pf, pl };
}
const kunj = async (k) => (await pg(`SELECT email, kontak_hp, asal_instansi, nama, status FROM kunjungan WHERE id = '${k}'`)).rows[0];
const selesaiOss = (who, t, over = {}) => sebagai(db, 'authenticated', AUTH[who],
  'SELECT public.layanan_selesai($1, $2, $3::jsonb, NULL, NULL) AS j', [t, 'oss', JSON.stringify({
    nama_pemohon: 'Budi Santoso', alamat_pemohon: 'PT Maju Jaya', no_hp: '081234567890', email: 'budi@majujaya.id',
    keperluan_awal: 'Mengurus NIB dan perizinan berusaha', nama_usaha: 'Maju Jaya', tipe_pelaku_usaha: 'non_perseorangan',
    status_penanaman_modal: 'PMDN', lokasi_usaha: 'Bandar Lampung', skala_usaha: 'Kecil', sektor_usaha_kbli: '47111',
    tindak_lanjut: 'Pendampingan OSS', uraian_solusi: 'Sudah dibantu', catatan_internal: '-', ...over })]);
const selesaiNon = (who, t, over = {}) => sebagai(db, 'authenticated', AUTH[who],
  'SELECT public.layanan_selesai($1, $2, $3::jsonb, NULL, NULL) AS j', [t, 'perizinan', JSON.stringify({
    nama_pemohon: 'Budi Santoso', alamat_pemohon: 'PT Maju Jaya', no_hp: '081234567890', email: 'budi@majujaya.id',
    keperluan_awal: 'Izin teknis di OPD', nama_perusahaan: 'PT Maju Jaya', lokasi_usaha: 'Metro', opd_teknis: 'Dinas PU',
    uraian_permohonan: 'Mohon izin', tindak_lanjut: 'Diteruskan', catatan_petugas: '-', ...over })]);

console.log('Helpdesk OSS: FO tidak mengisi email, petugas OSS melengkapi');
{
  const { k, t } = await siapkan({ lyn: L.oss, pet: 'poss' });
  const a = await kunj(k);
  cek('awal: data induk FO tanpa email dan tanpa HP', a.email === null && a.kontak_hp === null);
  const tolak = await selesaiOss('poss', t, { email: 'Tidak berlaku' });
  cek('email "Tidak berlaku" ditolak EMAIL_WAJIB', !tolak.ok && /EMAIL_WAJIB/.test(tolak.pesan), JSON.stringify(tolak));
  const tiketMasihBuka = await pg(`SELECT status FROM tiket_antrean WHERE id = '${t}'`);
  const adaForm = await pg(`SELECT count(*)::int AS n FROM pelayanan_oss WHERE tiket_id = '${t}'`);
  cek('penolakan membatalkan semuanya (tiket tetap dilayani, form tidak tersimpan)',
    tiketMasihBuka.rows[0].status === 'dilayani' && adaForm.rows[0].n === 0);
  const tolak2 = await selesaiOss('poss', t, { email: 'bukan-email' });
  cek('email berformat salah ditolak', !tolak2.ok && /EMAIL_WAJIB/.test(tolak2.pesan), JSON.stringify(tolak2));
  const ok = await selesaiOss('poss', t);
  cek('email nyata: layanan selesai', ok.ok, JSON.stringify(ok));
  const b = await kunj(k);
  cek('data induk dilengkapi: email', b.email === 'budi@majujaya.id', JSON.stringify(b));
  cek('data induk dilengkapi: HP dikanonkan', b.kontak_hp === '081234567890');
  cek('data induk dilengkapi: asal/instansi (nilai terbaru menang)', b.asal_instansi === 'PT Maju Jaya');
  const audit = await pg(`SELECT nilai_lama, nilai_baru FROM audit_log WHERE aksi = 'pendataan_identitas_disatukan' AND entitas_id = '${k}'`);
  cek('perubahan tercatat di audit_log dengan nilai lama dan baru', audit.ok && audit.rows.length === 1
    && audit.rows[0].nilai_baru.email === 'budi@majujaya.id' && audit.rows[0].nilai_lama.asal_instansi === 'CV Awal FO', JSON.stringify(audit));
  const survei = await pg(`SELECT tujuan_email FROM notifikasi WHERE payload->>'kunjungan_id' = '${k}' OR payload::text LIKE '%${k}%'`);
  cek('email survei/notifikasi kunjungan memakai email baru (bukan kosong)', survei.ok && survei.rows.some((r) => r.tujuan_email === 'budi@majujaya.id'), JSON.stringify(survei));
}

console.log('Nilai pengganti tidak mengotori data induk');
{
  const { k, t } = await siapkan({ lyn: L.oss, pet: 'poss', email: 'lama@fo.id', hp: '081300000000', instansi: 'CV Awal FO' });
  const ok = await selesaiOss('poss', t, { alamat_pemohon: 'Tidak berlaku', no_hp: 'Tidak berlaku', keperluan_awal: 'Tidak berlaku' });
  cek('selesai dengan nilai pengganti pada isian selain email', ok.ok, JSON.stringify(ok));
  const b = await kunj(k);
  cek('HP dan instansi FO tidak ditimpa "Tidak berlaku"', b.kontak_hp === '081300000000' && b.asal_instansi === 'CV Awal FO', JSON.stringify(b));
  cek('email nyata baru menimpa email lama FO', b.email === 'budi@majujaya.id', JSON.stringify(b));
  const keperluan = await pg(`SELECT keperluan FROM kunjungan WHERE id = '${k}'`);
  cek('keperluan FO tidak ditimpa "Tidak berlaku"', keperluan.rows[0].keperluan === 'Konsultasi awal dari FO');
}

console.log('Non OSS');
{
  const { k, t } = await siapkan({ lyn: L.non, pet: 'pnon' });
  const tolak = await selesaiNon('pnon', t, { email: '-' });
  cek('Non OSS: email "-" ditolak', !tolak.ok && /EMAIL_WAJIB/.test(tolak.pesan), JSON.stringify(tolak));
  const ok = await selesaiNon('pnon', t);
  cek('Non OSS: selesai dan email masuk data induk', ok.ok && (await kunj(k)).email === 'budi@majujaya.id', JSON.stringify(ok));
}

console.log('Layanan tanpa formulir tetap (Pendataan Khusus): identitas lewat layanan_selesai_khusus');
{
  const { k, t } = await siapkan({ lyn: L.khu, pet: 'pkhu' });
  const tanpa = await sebagai(db, 'authenticated', AUTH.pkhu,
    'SELECT public.layanan_selesai_khusus($1, $2, $3, NULL, NULL) AS j', [t, TOPIK, 'Sudah ditangani']);
  cek('tanpa email di mana pun: ditolak EMAIL_WAJIB', !tanpa.ok && /EMAIL_WAJIB/.test(tanpa.pesan), JSON.stringify(tanpa));
  const salah = await sebagai(db, 'authenticated', AUTH.pkhu,
    'SELECT public.layanan_selesai_khusus($1, $2, $3, NULL, $4::jsonb) AS j', [t, TOPIK, 'Sudah ditangani', JSON.stringify({ email: 'rusak' })]);
  cek('email identitas salah format ditolak', !salah.ok, JSON.stringify(salah));
  const ok = await sebagai(db, 'authenticated', AUTH.pkhu,
    'SELECT public.layanan_selesai_khusus($1, $2, $3, NULL, $4::jsonb) AS j', [t, TOPIK, 'Sudah ditangani', JSON.stringify({ email: 'Khusus@Contoh.ID', kontak_hp: '+6281399998888' })]);
  cek('dengan email nyata: selesai', ok.ok, JSON.stringify(ok));
  const b = await kunj(k);
  cek('email dinormalkan huruf kecil dan HP dikanonkan di data induk', b.email === 'khusus@contoh.id' && b.kontak_hp === '081399998888', JSON.stringify(b));
}
{
  const { k, t } = await siapkan({ lyn: L.khu, pet: 'pkhu', email: 'sudah@ada.id' });
  const ok = await sebagai(db, 'authenticated', AUTH.pkhu,
    'SELECT public.layanan_selesai_khusus($1, $2, $3, NULL, NULL) AS j', [t, TOPIK, 'Sudah ditangani']);
  cek('email sudah ada dari FO: tidak perlu diisi ulang', ok.ok, JSON.stringify(ok));
  cek('status kunjungan selesai', (await kunj(k)).status === 'selesai');
}
{
  const { t } = await siapkan({ lyn: L.khu, pet: 'pkhu', pengunjung: ID(6, 1) });
  const ok = await sebagai(db, 'authenticated', AUTH.pkhu,
    'SELECT public.layanan_selesai_khusus($1, $2, $3, NULL, NULL) AS j', [t, TOPIK, 'Sudah ditangani']);
  cek('email akun Google pengunjung dihitung sebagai email yang ada', ok.ok, JSON.stringify(ok));
}

console.log('Selesai di FO tanpa eskalasi: email boleh kosong');
{
  nomor += 1;
  const k = ID(4, nomor);
  const r = await pg(`
    INSERT INTO kunjungan(id, nama, asal, tanggal, status, dibuat_oleh) VALUES ('${k}','Tamu Cepat','walk_in', current_date,'menunggu','${PET.fo1}');
    UPDATE kunjungan SET status = 'selesai' WHERE id = '${k}' RETURNING status;`);
  cek('kunjungan yang selesai di FO tanpa email tidak terhalang', r.ok && r.rows[0].status === 'selesai', JSON.stringify(r));
}

console.log('FO pencatat membaca hasil lengkap (read-only); FO lain tidak');
{
  const { k, t, pl } = await siapkan({ lyn: L.oss, pet: 'poss', fo: 'fo1' });
  await selesaiOss('poss', t);
  const lihat = async (who, sql) => (await sebagai(db, 'authenticated', AUTH[who], sql)).rows?.length ?? -1;
  cek('FO pencatat melihat kunjungannya dengan email lengkap',
    (await sebagai(db, 'authenticated', AUTH.fo1, `SELECT email FROM kunjungan WHERE id = '${k}'`)).rows[0]?.email === 'budi@majujaya.id');
  cek('FO pencatat membaca form pendataan OSS yang dilengkapi petugas', (await lihat('fo1', `SELECT 1 FROM pelayanan_oss WHERE tiket_id = '${t}'`)) === 1);
  cek('FO pencatat membaca tahap layanan (catatan hasil) kunjungannya', (await lihat('fo1', `SELECT 1 FROM penanganan WHERE id = '${pl}'`)) === 1);
  cek('FO lain TIDAK membaca form pendataan itu', (await lihat('fo2', `SELECT 1 FROM pelayanan_oss WHERE tiket_id = '${t}'`)) === 0);
  cek('FO lain TIDAK membaca tahap layanan itu', (await lihat('fo2', `SELECT 1 FROM penanganan WHERE id = '${pl}'`)) === 0);
  const tulis = await sebagai(db, 'authenticated', AUTH.fo1, `UPDATE pelayanan_oss SET catatan_internal = 'ubah' WHERE tiket_id = '${t}' RETURNING 1`);
  cek('FO pencatat TIDAK dapat mengubah form (read-only)', !tulis.ok || tulis.rows.length === 0, JSON.stringify(tulis));
  const petugasLain = await lihat('pnon', `SELECT 1 FROM pelayanan_oss WHERE tiket_id = '${t}'`);
  cek('petugas layanan lain tetap TIDAK membaca', petugasLain === 0);
}

console.log('Backfill data lama (202611010004) dan rollback-nya');
{
  const berkas = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const backfill = berkas('../../supabase/migrations/202611010004_backfill_identitas_kunjungan.sql');
  const rollback = berkas('../../docs/rollback-backfill-identitas-kunjungan-202611010004.sql');
  const buat = (n, extra) => ({ k: ID(8, n), t: ID(8, 20 + n), ...extra });
  const A = buat(1), B = buat(2), C = buat(3), D = buat(4);
  const r = await pg(`
    SET session_replication_role = replica; -- data lama ditulis tanpa trigger baru
    INSERT INTO kunjungan(id, nama, asal, tanggal, status, dibuat_oleh, email, kontak_hp, asal_instansi) VALUES
      ('${A.k}','Lama Satu','walk_in', current_date - 30,'selesai','${PET.fo1}', NULL, NULL, NULL),
      ('${B.k}','Lama Dua','walk_in', current_date - 30,'selesai','${PET.fo1}', 'fo@ada.id', NULL, 'Instansi FO'),
      ('${C.k}','Lama Tiga','walk_in', current_date - 30,'selesai','${PET.fo1}', NULL, NULL, NULL),
      ('${D.k}','[anonim]','walk_in', current_date - 800,'selesai','${PET.fo1}', NULL, NULL, NULL);
    INSERT INTO tiket_antrean(id, kunjungan_id, layanan_id, tanggal, nomor, nomor_display, status) VALUES
      ('${A.t}','${A.k}','${L.oss}', current_date - 30, 1,'L-1','selesai'),
      ('${B.t}','${B.k}','${L.oss}', current_date - 30, 2,'L-2','selesai'),
      ('${C.t}','${C.k}','${L.non}', current_date - 30, 3,'L-3','selesai'),
      ('${D.t}','${D.k}','${L.oss}', current_date - 800, 4,'L-4','selesai');
    INSERT INTO pelayanan_oss(tiket_id, kunjungan_id, petugas_id, nama_pemohon, alamat_pemohon, no_hp, email, nama_usaha, tindak_lanjut, uraian_solusi, status_draft, is_locked) VALUES
      ('${A.t}','${A.k}','${PET.poss}','Lama Satu','CV Lama Jaya','+6281211112222','lama1@x.id','U','t','u','selesai',true),
      ('${B.t}','${B.k}','${PET.poss}','Lama Dua','Instansi Form','081211113333','lama2@x.id','U','t','u','selesai',true),
      ('${D.t}','${D.k}','${PET.poss}','Anon','CV Anon','081211114444','anon@x.id','U','t','u','selesai',true);
    INSERT INTO pelayanan_perizinan(tiket_id, kunjungan_id, petugas_id, nama_pemohon, alamat_pemohon, no_hp, email, nama_perusahaan, opd_teknis, uraian_permohonan, tindak_lanjut, status_draft, is_locked) VALUES
      ('${C.t}','${C.k}','${PET.pnon}','Lama Tiga','Tidak berlaku','Tidak berlaku','Tidak berlaku','P','o','u','t','selesai',true);
    SET session_replication_role = origin;`);
  if (!r.ok) { console.error('SEED BACKFILL GAGAL', r.pesan); process.exit(2); }
  const dry = async () => (await pg(`SELECT id::text, email, kontak_hp, asal_instansi FROM kunjungan WHERE id IN ('${A.k}','${B.k}','${C.k}','${D.k}') ORDER BY id`)).rows;
  const sebelum = await dry();
  const jalan = await pg(backfill);
  cek('backfill berjalan tanpa galat', jalan.ok, JSON.stringify(jalan));
  const [a, b, c, d] = await dry();
  cek('kolom kosong diisi dari formulir selesai (email, HP kanonik, instansi)',
    a.email === 'lama1@x.id' && a.kontak_hp === '081211112222' && a.asal_instansi === 'CV Lama Jaya', JSON.stringify(a));
  cek('nilai yang sudah ada TIDAK ditimpa; kolom kosong lain diisi',
    b.email === 'fo@ada.id' && b.asal_instansi === 'Instansi FO' && b.kontak_hp === '081211113333', JSON.stringify(b));
  cek('nilai pengganti ("Tidak berlaku") tidak masuk', c.email === null && c.kontak_hp === null && c.asal_instansi === null, JSON.stringify(c));
  cek('kunjungan teranonimkan dilewati', d.email === null && d.kontak_hp === null, JSON.stringify(d));
  const audit = await pg(`SELECT detail FROM audit_log WHERE aksi = 'backfill_identitas_kunjungan'`);
  cek('satu baris audit memuat jumlah dan rincian kolom yang diisi', audit.ok && audit.rows.length === 1 && audit.rows[0].detail.jumlah === 2, JSON.stringify(audit));
  const notif = await pg(`SELECT count(*)::int AS n FROM notifikasi WHERE payload::text LIKE '%${A.k}%' OR payload::text LIKE '%${B.k}%'`);
  cek('backfill tidak mengirim notifikasi/survei', notif.ok && notif.rows[0].n === 0, JSON.stringify(notif));
  await pg(backfill);
  const audit2 = await pg(`SELECT count(*)::int AS n FROM audit_log WHERE aksi = 'backfill_identitas_kunjungan'`);
  cek('idempoten: dijalankan ulang tidak mengisi apa pun dan tidak menambah audit', audit2.rows[0].n === 1, JSON.stringify(audit2));
  const koreksi = await pg(`UPDATE kunjungan SET asal_instansi = 'Dikoreksi Manual' WHERE id = '${A.k}'`);
  const bal = await pg(rollback);
  cek('rollback berjalan', koreksi.ok && bal.ok, JSON.stringify(bal));
  const [a2, b2] = await dry();
  cek('rollback mengosongkan kembali yang diisi backfill', a2.email === null && a2.kontak_hp === null, JSON.stringify(a2));
  cek('rollback tidak menyentuh koreksi manual dan nilai FO', a2.asal_instansi === 'Dikoreksi Manual' && b2.email === 'fo@ada.id' && b2.asal_instansi === 'Instansi FO', JSON.stringify([a2, b2]));
  cek('rollback memulihkan keadaan sebelum untuk B (HP kosong lagi)', b2.kontak_hp === sebelum[1].kontak_hp, JSON.stringify(b2));
}

console.log('Rollback 202611010003 dapat dijalankan dan mencabut aturan baru');
{
  const rb = readFileSync(new URL('../../docs/rollback-identitas-satu-kesatuan-202611010003.sql', import.meta.url), 'utf8');
  const { t } = await siapkan({ lyn: L.khu, pet: 'pkhu' });
  const hasil = await pg(rb);
  cek('rollback berjalan tanpa galat', hasil.ok, JSON.stringify(hasil));
  const fungsi = await pg("SELECT count(*)::int AS n FROM pg_proc WHERE proname IN ('email_nyata','kunjungan_terapkan_identitas','pelayanan_form_identitas','tiket_selesai_wajib_email')");
  cek('fungsi dan trigger baru hilang', fungsi.rows[0].n === 0, JSON.stringify(fungsi));
  const lama = await sebagai(db, 'authenticated', AUTH.pkhu, 'SELECT public.layanan_selesai_khusus($1, $2, $3, NULL) AS j', [t, TOPIK, 'Sudah ditangani']);
  cek('layanan_selesai_khusus 4 argumen kembali dan tidak menuntut email', lama.ok, JSON.stringify(lama));
}

ringkas();
await db.close();
