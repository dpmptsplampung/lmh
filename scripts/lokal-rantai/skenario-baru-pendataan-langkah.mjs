// G5, RPC/RLS pada rantai migrasi asli. Data sintetis; tanpa .env atau jaringan.
// Jalankan: node scripts/lokal-rantai/skenario-baru-pendataan-langkah.mjs
import { readFileSync } from 'node:fs';
import { bukaDbPenuh, sebagai, cek, ringkas } from './harness.mjs';

console.log('Host tujuan: PGlite lokal dalam memori; tanpa database eksternal.');
const db = await bukaDbPenuh({ sampai: '202611160002' });
const id = (grup, n) => `${grup}0000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const nama = ['admin', 'p1', 'p2', 'pk', 'p3', 'fo', 'fo2', 'nonaktif', 'warga'];
const U = Object.fromEntries(nama.map((r, i) => [r, id(0, i + 1)]));
const S = Object.fromEntries(nama.map((r, i) => [r, id(2, i + 1)]));
const L = n => id(1, n);
const K = n => id(3, n);
const T = n => id(4, n);
const F = n => id(6, n);
const TOP = n => id(7, n);
const pg = (sql, params) => sebagai(db, 'postgres', null, sql, params);
const user = (who, sql, params, jwt) => sebagai(db, 'authenticated', U[who], sql, params, jwt);
const wajib = r => { if (!r.ok) throw new Error(JSON.stringify(r)); return r; };
const nilai = r => wajib(r).rows[0]?.hasil;
const hitung = async (sql, params) => Number(nilai(await pg(sql, params)));
const mulai = async (n, who = 'p1') => nilai(await user(who, 'SELECT layanan_mulai($1) AS hasil', [T(n)]));
try {
  wajib(await pg(`
    SET session_replication_role = replica;
    INSERT INTO auth.users(id,email) VALUES ${nama.map(r => `('${U[r]}','${r}@example.invalid')`).join(',')};
    INSERT INTO layanan(id,nama,prefiks_antrean,slug,form_pendataan) VALUES
      ('${L(1)}','Khusus G5','GA','g5-khusus',NULL), ('${L(2)}','Lain G5','GB','g5-lain',NULL),
      ('${L(3)}','OSS G5','GC','g5-oss','oss'), ('${L(4)}','Tanpa Isian G5','GD','g5-tanpa',NULL),
      ('${L(5)}','Non OSS G5','GE','g5-non-oss','perizinan');
    INSERT INTO petugas(id,auth_user_id,nama,role,layanan_id,aktif,koordinator) VALUES
      ${nama.filter(r => r !== 'warga').map(r => `('${S[r]}','${U[r]}','${r}',
        '${r === 'admin' ? 'admin' : r.startsWith('fo') ? 'front_office' : 'petugas'}',
        ${r === 'admin' || r.startsWith('fo') ? 'NULL' : `'${r === 'p3' ? L(2) : L(1)}'`},
        ${r !== 'nonaktif'},${r === 'pk'})`).join(',')};
    INSERT INTO kunjungan(id,nama,asal,tanggal,status,dibuat_oleh,email,qr_token) VALUES
      ${Array.from({ length: 16 }, (_, i) => `('${K(i + 1)}','Pengunjung Sintetis','reservasi',
        (now() AT TIME ZONE 'Asia/Jakarta')::date,'menunggu','${S.fo}',
        'uji${i + 1}@example.invalid','g5-qr-${i + 1}')`).join(',')};
    INSERT INTO tiket_antrean(id,kunjungan_id,layanan_id,tanggal,nomor,nomor_display,status) VALUES
      ${Array.from({ length: 16 }, (_, i) => `('${T(i + 1)}','${K(i + 1)}',
        '${i === 6 ? L(4) : i === 7 ? L(3) : i === 14 ? L(5) : L(1)}',(now() AT TIME ZONE 'Asia/Jakarta')::date,
        ${i + 1},'GA-${i + 1}','menunggu')`).join(',')};
    INSERT INTO topik_penanganan(id,layanan_id,nama) VALUES
      ${[1, 2, 3, 4, 5].map(n => `('${TOP(n)}','${L(n)}','Lainnya')`).join(',')};
    SET session_replication_role = origin;
    INSERT INTO pendataan_khusus_field(id,layanan_id,label,jenis,wajib,urut,tersembunyi) VALUES
      ('${F(1)}','${L(1)}','Nomor Berkas','teks_singkat',true,2,false),
      ('${F(2)}','${L(1)}','Isian Tersembunyi','teks_singkat',true,1,true),
      ('${F(3)}','${L(1)}','Persetujuan','ya_tidak',false,3,false),
      ('${F(4)}','${L(2)}','Layanan Lain','teks_singkat',true,1,false);
  `));
  const hasil = await mulai(1);
  cek('mulai tiket tanpa tahap membuat penanganan_id', typeof hasil.penanganan_id === 'string');
  cek('tepat satu tahap layanan berjalan dibuat', await hitung(
    "SELECT count(*) AS hasil FROM penanganan WHERE tiket_id=$1 AND status='berjalan' AND peran_tahap='layanan'", [T(1)]) === 1);
  const ulang = await mulai(1);
  cek('mulai berulang mempertahankan tahap dan jam awal', ulang.sudah_milik_anda === true
    && ulang.penanganan_id === hasil.penanganan_id && ulang.waktu_mulai_layan === hasil.waktu_mulai_layan);
  cek('mulai berulang tidak menambah tahap', await hitung('SELECT count(*) AS hasil FROM penanganan WHERE tiket_id=$1', [T(1)]) === 1);
  for (const who of ['p2', 'p3', 'fo']) {
    cek(`${who} tidak dapat merebut tiket melalui Mulai`, !(await user(who, 'SELECT layanan_mulai($1)', [T(1)])).ok);
  }
  const jawaban = { [F(1)]: 'BERKAS-001', [F(3)]: false };
  const simpan = (who, n, isi) => user(who, 'SELECT pendataan_khusus_draf_simpan($1,$2::jsonb) AS hasil', [T(n), JSON.stringify(isi)]);
  const baca = (who, n) => user(who, 'SELECT pendataan_khusus_draf_baca($1) AS hasil', [T(n)]);
  const draf = await simpan('p1', 1, jawaban);
  cek('pemilik menyimpan draf', draf.ok && draf.rows[0]?.hasil?.ok === true);
  cek('draf tidak menandai pernah_diisi', nilai(await pg('SELECT pernah_diisi AS hasil FROM pendataan_khusus_field WHERE id=$1', [F(1)])) === false);
  for (const who of ['p2', 'pk', 'admin', 'p3', 'fo', 'fo2', 'nonaktif', 'warga']) {
    const r = await simpan(who, 1, {});
    cek(`${who} tidak menulis draf tanpa menjadi pemilik`, !r.ok && r.kode === '42501', r.pesan);
  }
  for (const who of ['p1', 'p2', 'pk', 'admin', 'fo']) {
    const r = await baca(who, 1);
    cek(`${who} membaca draf sesuai lingkup G2`, r.ok && r.rows[0]?.hasil?.jawaban?.[F(1)] === 'BERKAS-001');
  }
  for (const who of ['p3', 'nonaktif', 'warga']) {
    const r = await baca(who, 1);
    cek(`${who} ditolak membaca draf di luar lingkup`, !r.ok && r.kode === '42501');
  }
  const langsungFo2 = wajib(await user('fo2', 'SELECT tiket_id FROM pendataan_khusus_draf'));
  cek('FO lintas pembuat tidak melihat tabel draf langsung', langsungFo2.rows.length === 0);
  const bacaFo2 = await baca('fo2', 1);
  cek('RPC draf lama juga menolak FO lintas pembuat tanpa audit', !bacaFo2.ok && bacaFo2.kode === '42501');
  const lihatFo2 = nilai(await user('fo2', 'SELECT lihat_data_pelayanan($1) AS hasil', [T(1)]));
  cek('Lihat Data mengembalikan draf lintas pembuat dan definisi label terbaru',
    lihatFo2.draf?.jawaban?.[F(1)] === 'BERKAS-001' && lihatFo2.definisi_khusus.some(f => f.id === F(1) && f.label === 'Nomor Berkas'));
  cek('Lihat Data draf FO lintas pembuat mencatat audit', await hitung(
    "SELECT count(*) AS hasil FROM audit_log WHERE aksi='lihat_data' AND actor_id=$1 AND entitas_id=$2", [U.fo2, T(1)]) === 1);
  for (const who of ['p1', 'p2', 'fo', 'admin']) {
    for (const sql of [
      'INSERT INTO pendataan_khusus_draf(tiket_id,jawaban,diubah_oleh) VALUES($1,\'{}\',$2)',
      'UPDATE pendataan_khusus_draf SET jawaban=\'{}\' WHERE tiket_id=$1 AND diubah_oleh=$2',
      'DELETE FROM pendataan_khusus_draf WHERE tiket_id=$1 AND diubah_oleh=$2',
    ]) {
      const r = await user(who, sql, [T(1), S.p1]);
      cek(`${who} ditolak DML langsung ${sql.split(' ')[0]}`, !r.ok && r.kode === '42501');
    }
  }
  cek('draf tidak memvalidasi wajib saat autosave kosong', (await simpan('p1', 1, {})).ok);
  cek('draf menolak kunci layanan lain', !(await simpan('p1', 1, { [F(4)]: 'asing' })).ok);
  cek('draf menolak array', !(await simpan('p1', 1, [])).ok);
  cek('draf dibatasi 64 KiB', !(await simpan('p1', 1, { [F(1)]: 'x'.repeat(65536) })).ok);
  await simpan('p1', 1, jawaban);
  const def = await user('p1', 'SELECT * FROM pendataan_khusus_definisi($1)', [L(1)]);
  cek('definisi hanya isian terlihat dengan urutan terbaru', def.ok && JSON.stringify(def.rows.map(r => r.id)) === JSON.stringify([F(1), F(3)]));
  cek('layanan lain ditolak RPC definisi', !(await user('p3', 'SELECT * FROM pendataan_khusus_definisi($1)', [L(1)])).ok);
  const selesai = (who, n, khusus = null, topik = TOP(1), catatan = 'Catatan layanan sintetis', identitas = null) => user(who,
    'SELECT layanan_selesai_khusus($1,$2,$3,$4::jsonb,$5::jsonb) AS hasil',
    [T(n), topik, catatan, khusus === null ? null : JSON.stringify(khusus), identitas === null ? null : JSON.stringify(identitas)]);
  const final = await selesai('p1', 1);
  cek('Selesai memakai draf ketika p_khusus NULL', final.ok && final.rows[0]?.hasil?.khusus_tersimpan === 2, final.pesan);
  cek('Selesai menghapus draf', await hitung('SELECT count(*) AS hasil FROM pendataan_khusus_draf WHERE tiket_id=$1', [T(1)]) === 0);
  cek('jawaban final menyimpan nilai false dan label snapshot', nilai(await pg(
    'SELECT label_snapshot AS hasil FROM pendataan_khusus_jawaban WHERE penanganan_id=$1 AND field_id=$2', [hasil.penanganan_id, F(1)])) === 'Nomor Berkas'
    && nilai(await pg('SELECT nilai AS hasil FROM pendataan_khusus_jawaban WHERE penanganan_id=$1 AND field_id=$2', [hasil.penanganan_id, F(3)])) === false);
  cek('hanya final menandai pernah_diisi', nilai(await pg('SELECT pernah_diisi AS hasil FROM pendataan_khusus_field WHERE id=$1', [F(1)])) === true);
  cek('field tersembunyi wajib tidak menghasilkan jawaban final', await hitung('SELECT count(*) AS hasil FROM pendataan_khusus_jawaban WHERE field_id=$1', [F(2)]) === 0);
  const terlambat = await simpan('p1', 1, jawaban);
  cek('autosave terlambat sesudah Selesai ditolak', !terlambat.ok && terlambat.pesan.startsWith('INVALID_STATUS:'));
  const ulangSelesai = await selesai('p1', 1);
  cek('Selesai berulang tetap kontrak INVALID_STATUS', !ulangSelesai.ok && ulangSelesai.pesan.startsWith('INVALID_STATUS:'));

  // Tahap eskalasi yang sudah ada dipromosikan, tanpa membuat tahap kedua.
  wajib(await pg(`INSERT INTO penanganan(kunjungan_id,tahap_ke,peran_tahap,layanan_id,tiket_id,saluran,status)
    VALUES($1,1,'layanan',$2,$3,'walk_in','menunggu')`, [K(2), L(1), T(2)]));
  const sebelum = nilai(await pg('SELECT id AS hasil FROM penanganan WHERE tiket_id=$1', [T(2)]));
  cek('Mulai mempromosikan tahap menunggu yang sudah ada', (await mulai(2)).penanganan_id === sebelum);
  wajib(await simpan('p1', 2, {}));
  cek('baca langsung FO lolos RLS', wajib(await user('fo', 'SELECT tiket_id FROM pendataan_khusus_draf')).rows.length === 1);
  cek('baca langsung layanan lain disaring RLS', wajib(await user('p3', 'SELECT tiket_id FROM pendataan_khusus_draf')).rows.length === 0);
  const auditSebelum = await hitung('SELECT count(*) AS hasil FROM audit_log');
  const wajibGagal = await selesai('p1', 2, null, TOP(1), 'Catatan sah untuk rollback', { email: 'baru@example.invalid' });
  cek('Selesai menolak isian wajib yang kosong', !wajibGagal.ok && wajibGagal.kode === '22023' && wajibGagal.pesan.startsWith('KHUSUS_WAJIB:'));
  const selesaiLama = (n, form = null, payload = null, topik = TOP(1)) => user('p1',
    'SELECT layanan_selesai($1,$2,$3::jsonb,$4,$5) AS hasil',
    [T(n), form, payload === null ? null : JSON.stringify(payload), topik, 'Catatan klien lama']);
  const bypassLama = await selesaiLama(2);
  cek('RPC lama tidak dapat melewati Khusus wajib', !bypassLama.ok && bypassLama.kode === '22023'
    && bypassLama.pesan.startsWith('KHUSUS_WAJIB:'), bypassLama.pesan);
  for (const nama of ['layanan_selesai_inti', 'chat_selesai_inti']) {
    const r = await user('p1', `SELECT has_function_privilege(current_user, $1, 'EXECUTE') AS hasil`,
      [nama === 'layanan_selesai_inti' ? `public.${nama}(uuid,text,jsonb,uuid,text)` : `public.${nama}(uuid,uuid,text)`]);
    cek(`klien tidak mengeksekusi ${nama}`, r.ok && r.rows[0]?.hasil === false);
  }
  cek('gagal wajib mempertahankan status tiket dan draf', nilai(await pg('SELECT status AS hasil FROM tiket_antrean WHERE id=$1', [T(2)])) === 'dilayani'
    && nilai(await baca('p1', 2))?.jawaban && await hitung('SELECT count(*) AS hasil FROM pendataan_khusus_jawaban WHERE penanganan_id=$1', [sebelum]) === 0);
  cek('gagal wajib membatalkan identitas dan audit', nilai(await pg('SELECT email AS hasil FROM kunjungan WHERE id=$1', [K(2)])) === 'uji2@example.invalid'
    && await hitung('SELECT count(*) AS hasil FROM audit_log') === auditSebelum);
  wajib(await simpan('p1', 2, { [F(1)]: 99 }));
  const tipeGagal = await selesai('p1', 2);
  cek('tipe diperiksa ketika final, bukan autosave', !tipeGagal.ok && tipeGagal.pesan.startsWith('KHUSUS_TIDAK_VALID:'));
  wajib(await simpan('p1', 2, { [F(1)]: 'BERKAS-002', [F(2)]: 'abaikan tersembunyi' }));
  wajib(await pg('UPDATE pendataan_khusus_field SET label=$1,urut=0 WHERE id=$2', ['Nomor Berkas Terkini', F(1)]));
  const defTerbaru = wajib(await user('fo', 'SELECT * FROM pendataan_khusus_definisi($1)', [L(1)])).rows;
  cek('definisi memakai label dan urutan terbaru', defTerbaru[0].id === F(1) && defTerbaru[0].label === 'Nomor Berkas Terkini');
  cek('snapshot final terdahulu tidak berubah sesudah rename', nilai(await pg('SELECT label_snapshot AS hasil FROM pendataan_khusus_jawaban WHERE penanganan_id=$1 AND field_id=$2', [hasil.penanganan_id, F(1)])) === 'Nomor Berkas');
  wajib(await pg('UPDATE topik_penanganan SET aktif=false WHERE id=$1', [TOP(1)]));
  const tanpaSeed = await selesai('p1', 2, {}, null, null);
  cek('seed Lainnya nonaktif menghasilkan galat jelas', !tanpaSeed.ok && tanpaSeed.pesan.startsWith('TOPIK_SISTEM_TIDAK_ADA:'));
  cek('seed tidak dibuat diam-diam', await hitung('SELECT count(*) AS hasil FROM topik_penanganan WHERE layanan_id=$1', [L(1)]) === 1);
  wajib(await pg('UPDATE topik_penanganan SET aktif=true WHERE id=$1', [TOP(1)]));
  const finalDua = nilai(await selesai('p1', 2, {}, null, null));
  cek('p_khusus {} memakai draf dan mengabaikan field tersembunyi', finalDua.khusus_tersimpan === 1);
  cek('snapshot final baru memakai label terbaru', nilai(await pg('SELECT label_snapshot AS hasil FROM pendataan_khusus_jawaban WHERE penanganan_id=$1 AND field_id=$2', [sebelum, F(1)])) === 'Nomor Berkas Terkini');
  cek('topik default mengikuti seed dan catatan ditandai sistem', nilai(await pg('SELECT catatan AS hasil FROM penanganan WHERE id=$1', [sebelum])) === 'Diisi sistem: Pendataan Khusus telah diisi'
    && nilai(await pg('SELECT topik_id AS hasil FROM penanganan WHERE id=$1', [sebelum])) === TOP(1));

  await mulai(3);
  wajib(await simpan('p1', 3, { [F(1)]: 'draf lama' }));
  const asing = await selesai('p1', 3, { [F(1)]: 'benar', [F(4)]: 'asing' });
  cek('final menolak kunci layanan lain', !asing.ok && asing.kode === '22023' && asing.pesan.startsWith('KHUSUS_TIDAK_VALID:'));
  const eksp = nilai(await selesai('p1', 3, { [F(1)]: 'payload eksplisit' }));
  cek('pemanggil lama dengan jawaban eksplisit mengalahkan draf', nilai(await pg('SELECT nilai AS hasil FROM pendataan_khusus_jawaban WHERE penanganan_id=$1 AND field_id=$2', [eksp.penanganan_id, F(1)])) === 'payload eksplisit');

  await mulai(4);
  wajib(await simpan('p1', 4, { [F(1)]: 'draf sebelum ambil alih' }));
  wajib(await user('pk', 'SELECT koordinator_ambil_alih_tiket($1,$2)', [T(4), 'Pengujian ambil alih G5']));
  cek('draf tetap melekat pada tiket sesudah Koordinator mengambil alih', nilai(await baca('pk', 4)).diubah_oleh === S.p1);
  cek('pemilik lama ditolak sesudah ambil alih', !(await simpan('p1', 4, {})).ok && !(await selesai('p1', 4)).ok);
  wajib(await simpan('pk', 4, { [F(1)]: 'diselesaikan Koordinator' }));
  const finalK = nilai(await selesai('pk', 4));
  cek('Koordinator pemilik baru menulis dan memfinalisasi draf', nilai(await pg('SELECT diisi_oleh AS hasil FROM pendataan_khusus_jawaban WHERE penanganan_id=$1', [finalK.penanganan_id])) === S.pk);
  await mulai(5);
  wajib(await simpan('p1', 5, { [F(1)]: 'draf untuk Admin' }));
  wajib(await user('admin', 'SELECT admin_ambil_alih($1,$2)', [T(5), 'Pengujian ambil alih Admin G5']));
  cek('Admin dapat menyimpan hanya setelah ambil alih', (await simpan('admin', 5, { [F(1)]: 'diubah Admin' })).ok);
  cek('Admin pemilik baru dapat menyelesaikan', (await selesai('admin', 5)).ok);

  // Tiket sudah dilayani sebelum G5, tanpa tahap, tanggal kemarin: tidak perlu Mulai ulang.
  wajib(await pg(`SET session_replication_role=replica;
    UPDATE tiket_antrean SET status='dilayani',dilayani_oleh='${S.p1}',waktu_mulai_layan=now()-interval '1 day',
      tanggal=(now() AT TIME ZONE 'Asia/Jakarta')::date-1 WHERE id='${T(6)}';
    UPDATE kunjungan SET status='dilayani' WHERE id='${K(6)}';
    SET session_replication_role=origin;`));
  const legacy = nilai(await selesai('p1', 6, { [F(1)]: 'legacy tanpa tahap' }));
  cek('Selesai memulihkan wadah tiket lama yang sudah dilayani tanpa tahap', legacy.khusus_tersimpan === 1 && typeof legacy.penanganan_id === 'string');
  await mulai(7, 'admin');
  cek('belum ada draf dibedakan dari tiket tidak ada', nilai(await baca('admin', 7)) === null);
  const tidakAda = await user('admin', 'SELECT pendataan_khusus_draf_baca($1)', [T(99)]);
  cek('tiket tidak ada memberi NOT_FOUND', !tidakAda.ok && tidakAda.kode === 'P0002');
  const tanpaKhusus = nilai(await user('admin', 'SELECT layanan_selesai_khusus($1,$2,$3) AS hasil', [T(7), TOP(4), 'Tanpa isian aktif tetap selesai']));
  cek('pemanggil 3 argumen dapat menyelesaikan layanan tanpa isian aktif', tanpaKhusus.ok && tanpaKhusus.khusus_tersimpan === 0);
  await mulai(8, 'admin');
  const drafTetap = await simpan('admin', 8, {});
  cek('draf Khusus menolak layanan formulir tetap', !drafTetap.ok && drafTetap.pesan.startsWith('LAYANAN_TETAP:'));
  const finalTetap = await selesai('admin', 8, null, TOP(3));
  cek('formulir tetap tidak dilewati melalui wrapper Khusus', !finalTetap.ok && finalTetap.pesan.startsWith('INVALID_PAYLOAD:'));
  const common = { nama_pemohon: 'Pemohon Sintetis', alamat_pemohon: 'Alamat Sintetis', no_hp: '081234567890',
    email: 'sintetis@example.invalid', keperluan_awal: 'Konsultasi sintetis', lokasi_usaha: 'Lampung', tindak_lanjut: 'Selesai' };
  const oss = { ...common, nama_usaha: 'Usaha Uji', tipe_pelaku_usaha: 'tidak_berlaku', status_penanaman_modal: 'tidak_ada',
    skala_usaha: 'Tidak berlaku', sektor_usaha_kbli: 'Tidak berlaku', uraian_solusi: 'Solusi sintetis', catatan_internal: '-' };
  const tanpaPayload = await user('admin', "SELECT layanan_selesai($1,'oss',NULL)", [T(8)]);
  cek('RPC lama OSS tetap menolak payload tidak lengkap', !tanpaPayload.ok && tanpaPayload.pesan.startsWith('INVALID_PAYLOAD:'));
  const ossSelesai = await user('admin', "SELECT layanan_selesai($1,'oss',$2::jsonb) AS hasil", [T(8), JSON.stringify(oss)]);
  cek('RPC lama OSS tetap menyelesaikan formulir lengkap', ossSelesai.ok, ossSelesai.pesan);
  await mulai(15, 'admin');
  const nonOss = { ...common, nama_perusahaan: 'Perusahaan Uji', opd_teknis: 'OPD Uji', uraian_permohonan: 'Permohonan Uji', catatan_petugas: '-' };
  const nonOssSelesai = await user('admin', "SELECT layanan_selesai($1,'perizinan',$2::jsonb) AS hasil", [T(15), JSON.stringify(nonOss)]);
  cek('RPC lama Non OSS tetap menyelesaikan formulir lengkap', nonOssSelesai.ok, nonOssSelesai.pesan);
  await mulai(13);
  wajib(await simpan('p1', 13, { [F(1)]: 'draf klien lama' }));
  const lamaDenganDraf = await selesaiLama(13);
  cek('RPC lama menyimpan draf sebagai jawaban final', lamaDenganDraf.ok
    && lamaDenganDraf.rows[0]?.hasil?.khusus_tersimpan === 1, lamaDenganDraf.pesan);
  cek('RPC lama menghapus draf sesudah sukses', await hitung('SELECT count(*) AS hasil FROM pendataan_khusus_draf WHERE tiket_id=$1', [T(13)]) === 0);
  await mulai(16);
  const formPalsu = await selesaiLama(16, 'oss', oss);
  cek('argumen OSS palsu tidak melewati Khusus wajib layanan tanpa form', !formPalsu.ok && formPalsu.pesan.startsWith('KHUSUS_WAJIB:'));
  const aliasLama = await user('p1', "SELECT finalize_pelayanan($1,'oss',$2::jsonb)", [T(16), JSON.stringify(oss)]);
  cek('alias finalize_pelayanan juga tidak melewati Khusus wajib', !aliasLama.ok && aliasLama.pesan.startsWith('KHUSUS_WAJIB:'));

  await mulai(9);
  await mulai(14);
  wajib(await simpan('p1', 14, { [F(1)]: 'draf lama saat saklar mati' }));
  wajib(await simpan('p1', 9, { [F(1)]: 'draf sebelum saklar mati' }));
  wajib(await user('admin', 'UPDATE layanan SET pendataan_khusus_aktif=false WHERE id=$1', [L(1)]));
  cek('saklar nonaktif membuat definisi aktif kosong', wajib(await user('p1', 'SELECT * FROM pendataan_khusus_definisi($1)', [L(1)])).rows.length === 0);
  const nonaktif = await simpan('p1', 9, {});
  cek('saklar nonaktif menolak autosave baru', !nonaktif.ok && nonaktif.pesan.startsWith('KHUSUS_NONAKTIF:'));
  cek('draf terdahulu tetap dapat dibaca saat saklar nonaktif', nilai(await baca('fo', 9)).jawaban[F(1)] === 'draf sebelum saklar mati');
  const finalNonaktif = nilai(await selesai('p1', 9));
  cek('saklar nonaktif melewati wajib dan menghapus draf saat Selesai', finalNonaktif.khusus_tersimpan === 0 && nilai(await baca('p1', 9)) === null);
  const lamaNonaktif = await selesaiLama(14);
  cek('RPC lama menaati saklar nonaktif dan membersihkan draf', lamaNonaktif.ok
    && lamaNonaktif.rows[0]?.hasil?.khusus_tersimpan === 0 && nilai(await baca('p1', 14)) === null, lamaNonaktif.pesan);
  const definisiEkspor = wajib(await user('fo', `SELECT id,label FROM pendataan_khusus_field
    WHERE layanan_id=$1 AND (NOT tersembunyi OR pernah_diisi) ORDER BY urut,created_at,id`, [L(1)])).rows;
  cek('ekspor masih membaca label definisi terbaru walaupun layanan dinonaktifkan', definisiEkspor[0].id === F(1) && definisiEkspor[0].label === 'Nomor Berkas Terkini');
  const peta = nilai(await user('fo', 'SELECT pendataan_khusus_peta($1::uuid[]) AS hasil', [[hasil.penanganan_id, sebelum]]));
  cek('peta ekspor menghubungkan jawaban lama/baru lewat field_id', peta[hasil.penanganan_id][F(1)] === 'BERKAS-001' && peta[sebelum][F(1)] === 'BERKAS-002');
  wajib(await pg('UPDATE layanan SET pendataan_khusus_aktif=true WHERE id=$1', [L(1)]));

  // Kedua signature chat publik harus menegakkan wajib dan saklar yang sama.
  const C = n => id(9, n);
  wajib(await pg(`SET session_replication_role=replica;
    INSERT INTO chat_sesi(id,layanan_id,status,ditangani_oleh,kunjungan_id)
      VALUES ${[20, 21, 22].map(n => `('${C(n)}','${L(1)}','aktif','${S.p1}','${K(n)}')`).join(',')};
    INSERT INTO kunjungan(id,nama,asal,tanggal,status,dibuat_oleh,email,qr_token,chat_sesi_id)
      VALUES ${[20, 21, 22].map(n => `('${K(n)}','Chat Sintetis','online',
        (now() AT TIME ZONE 'Asia/Jakarta')::date,'dilayani','${S.fo}',
        'chat${n}@example.invalid','chat-g5-${n}','${C(n)}')`).join(',')};
    INSERT INTO penanganan(kunjungan_id,chat_sesi_id,tahap_ke,peran_tahap,layanan_id,saluran,status,penangan_id,mulai_at)
      VALUES ${[20, 21, 22].map(n => `('${K(n)}','${C(n)}',1,'layanan','${L(1)}','chat','berjalan','${S.p1}',now())`).join(',')};
    SET session_replication_role=origin;`));
  const chatLama = n => user('p1', 'SELECT chat_selesai($1,$2,$3) AS hasil', [C(n), TOP(1), 'Catatan chat sintetis']);
  const chatKhusus = (n, isi = null) => user('p1', 'SELECT chat_selesai_khusus($1,$2,$3,$4::jsonb) AS hasil',
    [C(n), TOP(1), 'Catatan chat sintetis', isi === null ? null : JSON.stringify(isi)]);
  for (const rpc of [chatLama, chatKhusus]) {
    const r = await rpc(20);
    cek('RPC chat publik menolak Khusus wajib kosong', !r.ok && r.kode === '22023' && r.pesan.startsWith('KHUSUS_WAJIB:'), r.pesan);
  }
  cek('gagal wajib chat membatalkan status dan pesan penutup', nilai(await pg('SELECT status AS hasil FROM chat_sesi WHERE id=$1', [C(20)])) === 'aktif'
    && await hitung('SELECT count(*) AS hasil FROM chat_pesan WHERE sesi_id=$1', [C(20)]) === 0);
  const chatFinal = await chatKhusus(20, { [F(1)]: 'jawaban chat final' });
  cek('chat menyimpan jawaban final valid', chatFinal.ok && chatFinal.rows[0]?.hasil?.khusus_tersimpan === 1, chatFinal.pesan);
  wajib(await pg('UPDATE layanan SET pendataan_khusus_aktif=false WHERE id=$1', [L(1)]));
  for (const [n, rpc] of [[21, chatLama], [22, chatKhusus]]) {
    const r = await rpc(n);
    cek('RPC chat publik menaati saklar nonaktif', r.ok && r.rows[0]?.hasil?.khusus_tersimpan === 0, r.pesan);
  }
  wajib(await pg('UPDATE layanan SET pendataan_khusus_aktif=true WHERE id=$1', [L(1)]));

  await mulai(10);
  wajib(await simpan('p1', 10, { [F(1)]: 'draf sebelum sesi diganti' }));
  wajib(await pg('INSERT INTO sesi_staf(user_id,session_id) VALUES($1,$2)', [U.p1, id(8, 1)]));
  for (const [label, sql, params] of [
    ['mulai', 'SELECT layanan_mulai($1)', [T(10)]],
    ['simpan', "SELECT pendataan_khusus_draf_simpan($1,'{}'::jsonb)", [T(10)]],
    ['baca', 'SELECT pendataan_khusus_draf_baca($1)', [T(10)]],
    ['definisi', 'SELECT * FROM pendataan_khusus_definisi($1)', [L(1)]],
    ['selesai', 'SELECT layanan_selesai_khusus($1,$2,$3)', [T(10), TOP(1), 'Catatan sesi digantikan']],
  ]) {
    const r = await user('p1', sql, params);
    cek(`sesi digantikan ditolak ${label}`, !r.ok && r.kode === '42501' && r.pesan.startsWith('SESI_TIDAK_SAH:'));
  }
  cek('sesi digantikan ditolak RLS baca langsung draf', wajib(await user('p1', 'SELECT * FROM pendataan_khusus_draf')).rows.length === 0);
  wajib(await pg('DELETE FROM sesi_staf WHERE user_id=$1', [U.p1]));

  await mulai(11);
  wajib(await pg(`INSERT INTO pendataan_khusus_field(id,layanan_id,label,jenis,wajib,urut) VALUES
    ($1,$3,'Wajib lalu disembunyikan','teks_singkat',true,4),
    ($2,$3,'Dihapus setelah draf','teks_singkat',false,5)`, [F(5), F(6), L(1)]));
  wajib(await simpan('p1', 11, { [F(1)]: 'aktif tetap diisi', [F(5)]: 'jawaban yang disembunyikan', [F(6)]: 'jawaban yang dihapus' }));
  wajib(await user('admin', 'UPDATE pendataan_khusus_field SET tersembunyi=true WHERE id=$1', [F(5)]));
  wajib(await user('admin', 'DELETE FROM pendataan_khusus_field WHERE id=$1', [F(6)]));
  const finalTersembunyi = nilai(await selesai('p1', 11));
  cek('field wajib disembunyikan sesudah autosave tidak lagi divalidasi', finalTersembunyi.khusus_tersimpan === 1);
  cek('field tersembunyi dari draf tidak ditandai pernah_diisi', nilai(await pg('SELECT pernah_diisi AS hasil FROM pendataan_khusus_field WHERE id=$1', [F(5)])) === false);
  wajib(await user('admin', 'UPDATE pendataan_khusus_field SET tersembunyi=true WHERE id=$1', [F(3)]));
  const historis = wajib(await user('fo', `SELECT id FROM pendataan_khusus_field
    WHERE layanan_id=$1 AND (NOT tersembunyi OR pernah_diisi) ORDER BY urut,created_at,id`, [L(1)])).rows.map(r => r.id);
  cek('ekspor mempertahankan field tersembunyi yang berjawaban, bukan draf saja', historis.includes(F(3)) && !historis.includes(F(5)) && !historis.includes(F(2)));
  cek('jawaban historis tersembunyi tetap tersedia lewat peta ekspor', nilai(await user('fo', 'SELECT pendataan_khusus_peta($1::uuid[]) AS hasil', [[hasil.penanganan_id]]))[hasil.penanganan_id][F(3)] === false);

  // Galat setelah INSERT jawaban final harus membatalkan status, snapshot, pernah_diisi, dan identitas.
  await mulai(12);
  wajib(await pg(`INSERT INTO pendataan_khusus_field(id,layanan_id,label,jenis,wajib,urut)
    VALUES($1,$2,'Isian rollback','teks_singkat',true,6)`, [F(7), L(1)]));
  wajib(await simpan('p1', 12, { [F(1)]: 'berkas rollback', [F(7)]: 'isian rollback' }));
  wajib(await pg(`CREATE FUNCTION pg_temp.g5_tolak_hapus() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'UJI_G5_GAGAL_HAPUS_DRAF'; END $$;
    CREATE TRIGGER g5_uji_hapus_draf BEFORE DELETE ON pendataan_khusus_draf
      FOR EACH ROW EXECUTE FUNCTION pg_temp.g5_tolak_hapus();`));
  const hapusGagal = await selesai('p1', 12, null, TOP(1), 'Catatan untuk rollback penuh', { email: 'baru12@example.invalid' });
  cek('galat setelah tulis final diteruskan ke pemanggil', !hapusGagal.ok && hapusGagal.pesan === 'UJI_G5_GAGAL_HAPUS_DRAF');
  const pid12 = nilai(await pg("SELECT id AS hasil FROM penanganan WHERE tiket_id=$1 AND status='berjalan'", [T(12)]));
  cek('gagal hapus draf membatalkan finalisasi tiket dan tahap', typeof pid12 === 'string'
    && nilai(await pg('SELECT status AS hasil FROM tiket_antrean WHERE id=$1', [T(12)])) === 'dilayani');
  cek('gagal hapus draf membatalkan INSERT jawaban final', await hitung('SELECT count(*) AS hasil FROM pendataan_khusus_jawaban WHERE penanganan_id=$1', [pid12]) === 0);
  cek('gagal hapus draf membatalkan pernah_diisi dan identitas', nilai(await pg('SELECT pernah_diisi AS hasil FROM pendataan_khusus_field WHERE id=$1', [F(7)])) === false
    && nilai(await pg('SELECT email AS hasil FROM kunjungan WHERE id=$1', [K(12)])) === 'uji12@example.invalid');
  cek('gagal hapus draf mempertahankan draf asal', nilai(await baca('p1', 12)).jawaban[F(7)] === 'isian rollback');
  const hapusLamaGagal = await selesaiLama(12);
  cek('RPC lama juga rollback saat penghapusan draf gagal', !hapusLamaGagal.ok
    && nilai(await pg('SELECT status AS hasil FROM tiket_antrean WHERE id=$1', [T(12)])) === 'dilayani'
    && await hitung('SELECT count(*) AS hasil FROM pendataan_khusus_jawaban WHERE penanganan_id=$1', [pid12]) === 0);
  wajib(await pg('DROP TRIGGER g5_uji_hapus_draf ON pendataan_khusus_draf; DROP FUNCTION pg_temp.g5_tolak_hapus()'));
  const ulangSetelahGagal = nilai(await selesaiLama(12));
  cek('retry setelah kegagalan transaksi menyimpan tepat satu set jawaban', ulangSetelahGagal.khusus_tersimpan === 2
    && await hitung('SELECT count(*) AS hasil FROM pendataan_khusus_jawaban WHERE penanganan_id=$1', [pid12]) === 2);

  cek('helper internal tidak dapat dipanggil authenticated', (await user('p1', 'SELECT pendataan_khusus_penanganan_pastikan($1)', [T(10)])).kode === '42501');
  for (const [namaRpc, sql, params] of [
    ['mulai', 'SELECT layanan_mulai($1)', [T(10)]],
    ['simpan draf', "SELECT pendataan_khusus_draf_simpan($1,'{}'::jsonb)", [T(10)]],
    ['baca draf', 'SELECT pendataan_khusus_draf_baca($1)', [T(10)]],
    ['definisi', 'SELECT * FROM pendataan_khusus_definisi($1)', [L(1)]],
    ['selesai', 'SELECT layanan_selesai_khusus($1,$2,$3)', [T(10), TOP(1), 'Catatan anon ditolak']],
  ]) {
    const r = await sebagai(db, 'anon', null, sql, params);
    cek(`anon ditolak EXECUTE ${namaRpc}`, !r.ok && r.kode === '42501');
  }
  const sebelumUlang = await hitung('SELECT count(*) AS hasil FROM pendataan_khusus_jawaban');
  const sqlG5 = readFileSync(new URL('../../supabase/migrations/202611160002_pendataan_khusus_langkah.sql', import.meta.url), 'utf8');
  wajib(await pg('UPDATE layanan SET pendataan_khusus_aktif=false WHERE id=$1', [L(1)]));
  wajib(await pg('BEGIN;\n' + sqlG5 + '\nCOMMIT;'));
  cek('penerapan ulang migrasi mempertahankan jawaban final', await hitung('SELECT count(*) AS hasil FROM pendataan_khusus_jawaban') === sebelumUlang);
  cek('penerapan ulang migrasi mempertahankan saklar dan draf', nilai(await pg('SELECT pendataan_khusus_aktif AS hasil FROM layanan WHERE id=$1', [L(1)])) === false
    && nilai(await baca('p1', 10)).jawaban[F(1)] === 'draf sebelum sesi diganti');
} finally {
  await db.close();
  ringkas();
}
